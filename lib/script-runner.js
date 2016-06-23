var fs = require('fs');
var util = require('util');
var path = require('path');
var childProcess = require('child_process');
var chalk = require('chalk');
var mustache = require('mustache');
var ejs = require('ejs');
var revalidator = require('revalidator');
var Logger = require('./logger');

/**
 * Run a script in a child process and wait for the script to finish execution
 * @param type the command type
 * @param module the module context
 * @param script the script to run
 * @param scriptConfig script configuration parameters to pass to the script
 * @param cwd current working directory of the script
 * @param outpost outpost object
 * @constructor
 */
function ScriptRunner(type, module, script, scriptConfig, cwd, outpost) {
  this.type = type;
  this.module = module;
  this.script = script;
  this.scriptConfig = scriptConfig || {};
  this.cwd = cwd;
  this.outpost = outpost;
  this.config = outpost.config;
  this.cache = outpost.cache;
  this.monitor = outpost.monitor;
  this.chalk = new chalk.constructor({enabled: true});

  var tag = 'outpost:script:' + type + ':' + module.fullname;
  this.logger = new Logger(tag, outpost.logger);
}

/**
 * Run the script as a child process
 * @param cb invoked when the script finished. receives the completion status and details message
 */
ScriptRunner.prototype.run = function(cb) {
  this.logger.debug('running script ' + this.script);
  var _this = this;
  fs.exists(this.script, function(exists) {
    if (!exists) {
      cb('skipped', 'script ' + _this.script + ' does not exist');
      return;
    }

    try {
      var scriptConfig = _this._resolveConfigDefaults(_this.scriptConfig);
    } catch (err) {
      cb('error', 'script error: ' + err.message);
      return;
    }

    try {
      var outpostConfig = util._extend({}, _this.config);
      delete outpostConfig.logger; // remove the logger from the config

      var result;
      var scriptTimeout = null;
      var startTime = Date.now();
      var maxExecutionTime = 2*60*1000;
      var child = childProcess.fork(path.resolve('lib/script.js'), {
        cwd: _this.cwd,
        env: {
          outpostScript: _this.script,
          outpostScriptType: _this.type,
          outpostScriptConfig: JSON.stringify(scriptConfig),
          outpostConfig: JSON.stringify(outpostConfig)
        }
      });

      function complete(result, details) {
        var logMessage = 'script completed with ' + result + (details ? ': ' + details : '');
        if (result === 'error') {
          _this.logger.error(logMessage);
        } else {
          _this.logger.debug(logMessage);
        }
        child && child.removeAllListeners();
        clearTimeout(scriptTimeout);
        scriptTimeout = null;
        cb(result, details);
      }

      function terminate(msg) {
        _this.logger.error('terminating script: ' + msg);
        child.kill('SIGKILL');
        clearTimeout(scriptTimeout);
        scriptTimeout = null;
        cb('error', msg);
      }

      function renewScriptTimeout() {
        if (scriptTimeout) {
          clearTimeout(scriptTimeout);
        }
        if (Date.now() - startTime > maxExecutionTime) {
          _this.logger.error('exceeded maximum time for script execution');
          terminate('timeout');
          return;
        }
        scriptTimeout = setTimeout(function() {
          terminate('timeout');
        }, 30 * 1000);
      }

      renewScriptTimeout();

      child.on('message', function(message) {

        renewScriptTimeout();

        // script ended running
        if (message.result) {
          complete(message.result, message.details);

        // start monitoring a process
        } else if (message.monitor) {
          _this.monitor.monitor(_this.module, message.monitor, function(err) {
            // send the callback back to the script
            child.send({cbid: message.cbid, args: [err]})
          });

        // stop monitoring a process
        } else if (message.unmonitor) {
          _this.monitor.unmonitor(message.unmonitor, function(err) {
            // send the callback back to the script
            child.send({cbid: message.cbid, args: [err]})
          });

        // run a script from a sub module
        } else if (message.script) {
          _this._runSubModuleScript(message.script.module, message.script.config, function(err) {
            // send the callback back to the script
            child.send({cbid: message.cbid, args: [err]})
          });

        // process a template
        } else if (message.template) {
          _this._processTemplate(message.template, message.context, message.output, function(err, result) {
            child.send({cbid: message.cbid, args: [err, result]});
          });

        // show some progress
        } else if (message.progress) {

        // log a message
        } else if (message.log) {
          _this.logger.info('> ' + _this.chalk.cyan(message.log));
        }

      });

      child.on('error', function(err) {
        terminate('error running script: ' + err);
      });

      child.on('exit', function(code, signal) {
        var error;
        if (code !== 0) {
          complete('error', 'exited with code ' + code + ' (signal ' + signal + ')');
          return;
        }

        if (!result) {
          complete('error', 'missing result');
        }

        // we already have a result and reported the script completion

      });

    } catch (e) {
      _this.logger.error(e.stack);
      complete('error', 'exception running script: ' + e.message);
    }
  });
};

/**
 * Apply default values specified in the module metadata to a context for template processing
 * @param context the context to apply the defaults on missing parameters
 * @private
 */
ScriptRunner.prototype._resolveConfigDefaults = function(context) {
  context = context || {};
  var schema = this.module.data && this.module.data.schema && this.module.data.schema[this.type];
  if (schema) {
    Object.keys(schema).forEach(function(key) {
      // apply the default
      if (context[key] === undefined) {
        context[key] = schema[key].default;
      }
    });

    // validate the config against the schema
    var result = revalidator.validate(context, {properties: schema}, {additionalProperties: true, validateFormatsStrict: true});
    if (!result.valid) {
      var errors = [];
      result.errors.forEach(function(err) {
        errors.push('"' + err.property + '" ' + err.message + ' (currently is ' + err.actual + ')');
      });
      throw new Error('config schema validation failed with the following error(s): ' + errors.join(', '));
    }

  }
  return context;
};

/**
 * Process a template
 * @param template the template to process
 * @param context context for the template
 * @param output the output file
 * @param cb
 * @private
 */
ScriptRunner.prototype._processTemplate = function(template, context, output, cb) {
  var _this = this;

  // try to read the template as a file
  var file = path.resolve(this.cwd, template);
  _this.logger.debug('trying to read template from file');
  fs.readFile(file, function(err, data) {
    if (err) {
      if (err.code !== 'ENOENT') {
        cb('error processing template ' + template + ': ' + err.message);
       return;
      }
      // let's assume that the template is a string
      _this.logger.debug('template file does not exist. falling back to string mode.');
      data = template;
    }

    if (typeof data !== 'string') {
      data = data.toString();
    }

    try {
      // render the template
      var result;
      if (file.match(/\.ejs$/)) {
        result = ejs.render(data, context);
      } else {
        result = mustache.render(data, context);
      }
      if (output) {
        // also try to save it to a file if needed
        var outFile = path.resolve(_this.cwd, output);
        _this.logger.debug('saving processed template to ' + outFile);
        fs.writeFile(outFile, result, function(err) {
          var error = null;
          if (err) {
            error = 'error saving processed template: ' + err.message;
            return;
          }
          cb(error, result);
        });
      } else {
        // no need to save to file
        cb(null, result);
      }
    } catch (err) {
      cb('error processing template: ' + err.message);
    }

  });
};

/**
 * Run a script of a submodule
 * @param module the submodule name
 * @param config the configuration to pass to the script
 * @param cb
 * @private
 */
ScriptRunner.prototype._runSubModuleScript = function(module, config, cb) {
  var _this = this;

  if (typeof module === 'object') {
    // module is the actual module object
    var moduleData = module.data;
    var script = moduleData && moduleData.scripts && moduleData.scripts[_this.type];
    if (!script) {
      cb('module ' + module.name +  ' has no ' + _this.type + ' script');
      return;
    }

    var targetDir = path.resolve(_this.cwd, '.outpost/modules/' + module.modulepath);
    var scriptPath = path.resolve(targetDir, script);
    var subRunner = new ScriptRunner(_this.type, module, scriptPath, config, targetDir, _this.outpost);
    subRunner.run(function(result, msg) {
      var err = undefined;
      if (result !== 'success') {
        err = msg;
      }
      cb(err);
    });
  } else {
    this.cache.installedModule(module, _this.cwd, function(err, _module) {
      if (err) {
        cb(err);
        return;
      }
      _this._runSubModuleScript(_module, config, cb);
    });
  }
};

exports = module.exports = ScriptRunner;

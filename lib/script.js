require('syswide-cas');

var child = require('child_process');
var path = require('path');
var url = require('url');
var fs = require('fs');
var util = require('util');
var crypto = require('crypto');
var mustache = require('mustache');
var proxying = require('proxying-agent');

process.on('uncaughtException', function(err) {
  outpost.fail('script exception: ' + err.stack);
});

/**
 * Script runner, providing a global object for use by outpost scripts
 */

var script = process.env['outpostScript'];
if (!script) {
  outpost.fail('script not specified');
  return;
}

var scriptType = process.env['outpostScriptType'];
if (!scriptType) {
  outpost.fail('script type not specified');
  return;
}

// the outpost main config
var config = JSON.parse(process.env['outpostConfig'] || '{}');

var callbacks = {};

// the process will receive messages that are callbacks
process.on('message', function(msg) {
  if (msg.cbid && callbacks[msg.cbid]) {
    callbacks[msg.cbid].apply(null, msg.args);
  }
});

function processStrings(obj) {
  if (typeof obj === 'string') {
    var result = mustache.render(obj, global);
    if (result != obj) {
      obj = processStrings(result);
    }
  } else if (typeof obj === 'object') {
    if (Array.isArray(obj)) {
      obj.forEach(function(el, index) {
        obj[index] = processStrings(el);
      });
    } else if (obj !== null) {
      Object.keys(obj).forEach(function(key) {
        obj[key] = processStrings(obj[key]);
      });
    }
  }

  return obj;
}


/**
 * global outpost object with utility functions for use in scripts
 */
outpost = {

  /**
   * outpost configuration
   */
  opconfig: config,

  /**
   * script configuration
   */
  config: JSON.parse(process.env['outpostScriptConfig'] || '{}'),

  /**
   * Proxy information or null if there is not proxy configured. This is derived from the outpost configuration:
   *  - url - proxy url of the form http[s]://[user:password@]hostname[:port]
   *  - authType - either 'basic' or 'ntlm'
   *  - ntlmDomain - the NTLM domain if authentication is NTLM
   */
  proxy: (function() {
    if (config.proxy) {
      return {
        url: config.proxy,
        authType: config.proxyAuthType,
        ntlmDomain: config.proxyNTLMDomain
      };
    }
    return null;
  })(),

  /**
   * Log a message to the console
   * @param message
   */
  log: function(message) {
    process.send({log: message});
  },

  /**
   * Indicate progress. if no progress is received at least once every 60 seconds, the script is terminated
   */
  progress: function() {
    process.send({progress: true});
  },

  /**
   * The script is done executing successfully.
   */
  done: function() {
    process.send({result: 'success'});
    setTimeout(function() {
      process.exit(0);
    }, 0);
  },

  /**
   * The script is done executing with an error. Terminates the script immediately.
   * @param message the error message
   */
  fail: function(message) {
    process.send({result: 'error', details: message});
    setTimeout(function() {
      process.exit(0);
    }, 0);
  },

  /**
   * Start a process and monitor it
   * @param info process information:
   *  - name - [required] the unique name of this monitored process used to identify this process in all later commands
   *  - cmd - the executable to execute. default is the node process that also started outpost
   *  - args - array of command line options to pass to the started process
   *  - cwd - the cwd for the process to monitor. default is the current module directory
   *  - env - a hash of environment variables for the launched process. defaults to the outpost environment variables
   *  - uid - user id to use for the launched process. defaults to the outpost user id
   *  - gid - group id to use for the launched process. defaults to the outpost group id
   *  - timeout - time in seconds to wait for the process to actually start. defaults to 10 seconds
   *  - checks - array of process checks. if a check fails, the process is restarted. the follosing checks are
   *     available:
   *      - maxUpTime - maximum time in minutes to allow the process to be up and running.
   *                    example: {type: 'maxUpTime', time: 24*60}
   *      - fileLastModified - interval in seconds that a file must be modified at least once.
   *                           example: {type: 'fileLastModified', file: '/path/to/file', time: 5*60}
   *  - logFile - the log file for the the process stdout and stderr. defaults to the logsDir setting as specified in
   *     the outpost configuration
   *  - pidFile - a custom pid file that stores the process id to monitor. defaults to the process id of the process
   *     that is launched
   *  - stopSignal - the signal to use to stop the process. default is SIGTERM
   * @param cb
   */
  monitor: function(info, cb) {
    var cbid = crypto.randomBytes(4).toString('hex');
    callbacks[cbid] = cb;
    info.cwd = path.resolve(process.cwd(), info.cwd || '');
    process.send({monitor: info, cbid: cbid});
  },

  /**
   * Start a process and monitor that it is running
   * @param info
   *  - name - [required] name of the process to unmonitor
   *  - timeout - time in seconds to wait for the process to actually stop. defaults to 10 seconds
   * @param cb
   */
  unmonitor: function(info, cb) {
    if (!info.name) {
      cb && cb('must provide process name');
      return;
    }
    var cbid = crypto.randomBytes(4).toString('hex');
    callbacks[cbid] = cb;
    process.send({unmonitor: info, cbid: cbid});
  },

  /**
   * Run a script of a submodule. the script that will run is the of the same type as the current script (install,
   * configure, etc.)
   * @param module the module name whose script is to be run
   * @param config the configuration to pass to the executed script
   * @param cb invoked when the script is done. receives err if the script failed.
   */
  script: function(module, config, cb) {
    if (!module) {
      cb && cb('must provide module name');
      return;
    }
    var cbid = crypto.randomBytes(4).toString('hex');
    callbacks[cbid] = cb;
    process.send({script: {module: module, config: config || {}}, cbid: cbid});
  },

  /**
   * Render a template. Template are processed as "mustache" templates (http://mustache.github.io/mustache.5.html)
   * @param template input template. may be a file name or the complete template string
   * @param context context for rendering the template
   * @param output output file. if provided, the result will also be saved to the specified file
   * @param cb receives err and the rendering result
   */
  template: function(template, context, output, cb) {
    if (!template) {
      cb && cb('must provide template');
      return;
    }
    var cbid = crypto.randomBytes(4).toString('hex');
    if (typeof output === 'function') {
      cb = output;
      output = null;
    }
    callbacks[cbid] = cb;
    process.send({template: template, context: context || {}, output: output, cbid: cbid});
  },

  /**
   * Get an http agent that can be used with the built-in node http/https module
   * @param target the target url to proxy to, or a boolean indicating whether to tunnel the communication through the proxy using CONNECT
   * @returns a properly configured proxy agent or null if there is no proxy
   */
  proxyAgent: function(target) {
    if (typeof target === 'boolean') {
      target = target ? 'https:' : 'http:';
    }
    var agent = false;
    if (this.proxy) {
      var proxyingOptions = {
        proxy: this.proxy.url,
        authType: this.proxy.authType,
        ntlm: {
          domain: this.proxy.proxyNTLMDomain
        }
      };
      agent = proxying.create(proxyingOptions, target);
    }
    return agent;
  },

  /**
   * Perform an HTTP request, automatically going through the proxy if one is defined in outpost
   * @param options request options:
   *  - url - url to make the request to
   *  - method - request method. default is GET
   *  - data - data to send on the request
   * @param cb receives err and the result of the http request
   */
  http: function(options, cb) {
    if (typeof options === 'string') {
      options = {url: options};
    }
    if (typeof options.url === 'string') {
      options = util._extend(options, url.parse(options.url));
    }
    var secure = options.protocol === 'https:';
    var requestor = secure ? require('https') : require('http');
    options.method = options.method || 'GET';
    options.agent = options.agent !== undefined ? options.agent : this.proxyAgent(secure);
    var req = requestor.request(options, function(res) {
      var data = '';
      res.on('data', function(d) {
        data += d;
      });
      res.on('end', function() {
        cb && cb(null, data, res);
      });
    });
    req.on('socket', function() {
      if (options.data) {
        req.write(options.data);
      }
      req.end();
    });
    req.on('error', function(err) {
      cb && cb(err.message);
    });
  },

  /**
   * Read lines from the end of the specified file, up to limit number of bytes.
   * @param file the file to read lines from the end
   * @param limit maximum number of bytes to read. default is 10k.
   * @param cb invoked with the content
   */
  tail: function(file, limit, cb) {
    if (typeof limit === 'function') {
      cb = limit;
      limit = undefined;
    }
    limit = limit || 10*1024;
    var logFile = path.resolve(file);
    fs.stat(logFile, function(err, stats) {
      if (err) {
        cb && cb(err);
        return;
      }
      var size = Math.min(limit, stats.size);
      var start = stats.size - size;
      var stream = fs.createReadStream(logFile, {encoding: 'utf8', start: start, end: stats.size - 1});
      var buf = undefined;
      stream.on('data', function(chunk) {
        if (!buf) {
          var i = 0;
          while (i < chunk.length && chunk.charAt(i++) !== '\n'){}
          if (i < chunk.length) {
            buf = chunk.substring(i);
          }
        } else {
          buf += chunk;
        }
      });
      stream.on('end', function() {
        cb && cb(null, buf);
        cb = null;
      });
      stream.on('error', function(err) {
        cb && cb(err.message ? err.message : err);
        cb = null;
      });
    });
  },

  /**
   *  Read lines from the end of the specified file up to limit number of bytes, and log them to the outpost log file.
   * @param file the file to read lines from the end
   * @param limit maximum number of bytes to read. default is 10k.
   * @param cb invoked when logging is done with the error
   */
  logTail: function(file, limit, cb) {
    if (typeof limit === 'function') {
      cb = limit;
      limit = undefined;
    }
    var self = this;
    this.tail(file, limit, function(err, content) {
      if (err) {
        self.log('error in log tail of file ' + file + ': ' + err);
      } else {
        self.log(file + ':\n' + content);
      }
      cb && cb(err);
    });
  },

  /**
   * Execute a command line. stderr is automatically redirected to stdout so no need to specify that on the command
   * line.
   * @param cmd the command line to execute
   * @param options (optional) options for the command:
   *  - cwd - the working directory to execute the command from
   *  - timeout - time to wait (in seconds) for the command to complete before it is forcefully terminated
   * @param cb completion callback:
   *  - code - the exit code of the command
   *  - signal - if the command exited with an error because of timeout or some other signal
   *  - output - the console output (stderr and stdout merged)
   * @returns {*}
   */
  exec: function(cmd, options, cb) {
    if (typeof options === 'function') {
      cb = options;
      options = {};
    }
    cmd = cmd + ' 2>&1';
    child.exec(
        cmd,
        {
          encoding: options.encoding || 'utf8',
          timeout: (options.timeout || 0) * 1000,
          maxBuffer: options.maxBuffer || 1000 * 1024,
          killSignal: options.killSignal || 'SIGTERM',
          cwd: options.cwd,
          env: options.env
        },
        function(error, stdout) {
          var code = error ? error.code : 0;
          var signal = error ? error.signal : null;
          cb(code, signal, stdout);
        }
    )
  }
};

try {
  // process config templates, disable html escaping
  var orig = mustache.escapeHtml;
  mustache.tags = ['${', '}'];
  mustache.escape = function(str) { return str; };
  outpost.config = processStrings(outpost.config);
  mustache.escape = orig;
} catch(e) {
  outpost.fail('error processing config strings (possible circular definition): ' + e.message);
  return;
}

// invoke the script. the global object 'outpost' is available to the script
require(script);

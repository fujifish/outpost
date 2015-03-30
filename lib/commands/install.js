var util = require('util');
var fs = require('fs');
var path = require('path');
var npm = require('npm');
var Command = require('../command');

function CommandInstall() {
  Command.call(this, 'install');
}

util.inherits(CommandInstall, Command);

CommandInstall.prototype._loadCacheManifest = function(cb) {
  var _this = this;
  var manifestFile = this.command.config.cache + '/manifest';
  fs.exists(manifestFile, function(exists) {
    if (exists) {
      fs.readFile(manifestFile, function (err, data) {
        if (err) {
          cb('error reading cache manifest: ' + err);
          return;
        }
        cb(null, JSON.parse(data));
      });
    } else {
      _this.logger.debug('cache manifest does not exist yet');
      cb(null, {version: "1", modules:{}});
    }
  });
};

CommandInstall.prototype._saveCacheManifest = function(manifest, cb) {
  var manifestFile = this.command.config.cache + '/manifest';
  fs.writeFile(manifestFile, JSON.stringify(manifest), function (err) {
    cb(err);
  });
};

CommandInstall.prototype._enrichModuleData = function(data) {
  data.fullname = data.name + '@' + data.version;
  data.modulepath = data.name + '/' + data.version;
  return data;
};


CommandInstall.prototype._init = function(cb) {
  if (this.manifest) {
    cb(null);
    return;
  }

  var _this = this;
  var npmConfig = {
    cache: this.command.config.cache,
    'fetch-retries': 2
  };

  npm.load(npmConfig, function (err) {
    if (err) {
      cb('error loading npm config: ' + err);
      return;
    }
    _this._loadCacheManifest(function(err, manifest) {
      if (err) {
        cb(err);
        return;
      }
      _this.manifest = manifest;
      cb(null);
    });
  });
};

CommandInstall.prototype._processModule = function(data, unpackDir, cb) {

  data = this._enrichModuleData(data);

  var _this = this;
  var targetDir = unpackDir + '/' + data.modulepath;

  // unpack this module to the target directory
  this._unpackModule(data, targetDir, function(err) {
    if (err) {
      cb(err);
      return;
    }

    // download module dependencies and unpack them too
    var dependencies = data.config && data.config.modules || [];
    _this.logger.debug('processing module ' + data.fullname + ' dependencies: [' + dependencies + ']');
    function _download(index) {
      // run the installation script of this module only after all of the dependencies have been downloaded
      if (index === dependencies.length) {
        _this._install(data, targetDir, function(err, result) {
          cb(err, result);
        });
        return;
      }
      _this._downloadModule(dependencies[index], targetDir + '/modules/', function(err) {
        if (err) {
          cb(err);
          return;
        }
        _download(index + 1);
      });
    }
    _download(0);
  });

};

CommandInstall.prototype._downloadModule = function(module, unpackDir, cb) {
  var _this = this;
  if (_this.manifest.modules[module]) {
    // we have an entry in the cache for the module. read the package.json.
    _this.logger.debug('found module ' + module + ' in cache manifest');
    var packageFile = this.command.config.cache + '/' + _this.manifest.modules[module].path + '/package/package.json';
    fs.readFile(packageFile, function (err, data) {
      if (err) {
        cb('error reading module package file ' + packageFile + ': ' + err);
        return;
      }
      _this._processModule(JSON.parse(data), unpackDir, cb);
    });
  } else {
    _this.logger.debug('did not find module ' + module + ' in cache manifest. downloading module.');
    npm.commands.cache(['add', module], function(err, data) {
      if (err) {
        cb('error downloading module ' + module + ': ' + err);
        return;
      }
      _this.logger.info('downloaded module ' + module);
      _this.manifest.modules[module] = {
        module: module,
        name: data.name,
        version: data.version,
        path: data.name + '/' + data.version
      };
      _this._saveCacheManifest(_this.manifest, function(err) {
        if (err) {
          cb(err);
          return;
        }
        _this._processModule(data, unpackDir, cb);
      });
    });
  }
};

CommandInstall.prototype._unpackModule = function(data, targetDir, cb) {
  var _this = this;
  npm.commands.cache.unpack(data.name, data.version, targetDir, function(err) {
    if (err) {
      cb('error unpacking module ' + data.fullname + ': ' + err);
      return;
    }
    _this.logger.info('unpacked module ' + data.fullname);
    cb(null);
  });
};

CommandInstall.prototype._install = function(data, targetDir, cb) {
  var _this = this;
  var installScript = data.config && data.config.scripts && data.config.scripts.install;
  var installArgs = this.command.args && this.command.args.installArgs || [];
  if (installScript) {
    var scriptName = path.resolve(targetDir, installScript);
    _this.logger.info('running install script ' + scriptName + ' for module ' + data.fullname);
    fs.exists(scriptName, function(exists) {
      if (!exists) {
        cb('install script ' + scriptName + ' does not exist');
        return;
      }

      try {
        var childProcess = require('child_process');
        var scriptRunner = childProcess.fork(path.resolve('lib/script.js'), installArgs, {env: {outpostScript: scriptName}, cwd: targetDir});
        var result;
        var scriptTimeout = null;

        function complete(err, result) {
          _this.logger.info('install script completed');
          scriptRunner.removeAllListeners();
          clearTimeout(scriptTimeout);
          cb(err, result);
        }

        function terminate(error) {
          _this.logger.info('terminating install script');
          scriptRunner.kill('SIGKILL');
          cb(error);
        }

        function renewScriptTimeout() {
          clearTimeout(scriptTimeout);
          scriptTimeout = setTimeout(function() {
            terminate('timeout')
          }, 60 * 1000);
        }

        scriptRunner.on('message', function(message) {
          if (message.err) {
            terminate('error running install script for module ' + data.fullname + ': ' + message.err);
            return;
          }

          if (message.result) {
            complete(null, message.result);
            return;
          }

          if (message.progress) {
            renewScriptTimeout();
          }

          if (message.log) {
            _this.logger.info(message.log);
            renewScriptTimeout();
          }

        });

        scriptRunner.on('error', function(err) {
          terminate('error running install script for module ' + data.fullname + ': ' + err);
        });

        scriptRunner.on('exit', function(code, signal) {
          if (code !== 0) {
            result = 'abnormal termination (signal ' + signal + ')';
          }

          if (result === null) {
            result = 'missing result';
          }

          complete(result);
        });

      } catch (e) {
        _this.logger.error(e);
        complete('exception running install script for module ' + data.fullname + ': ' + e.message);
      }
    });
  } else {
    this.logger.info('module ' + data.fullname + ' has no install script');
    cb(null, 'success');
  }
};


CommandInstall.prototype.execute = function() {
  var _this = this;

  this._init(function(err) {
    if (err) {
      _this.complete('error', err);
      return;
    }

    var module = _this.command.args.module;
    _this._downloadModule(module, _this.command.config.modules, function(err, result) {
      if (err) {
        _this.complete('error', err);
        return;
      }
      _this.complete(result, null);
    });
  });
};

exports = module.exports = CommandInstall;

var util = require('util');
var fs = require('fs');
var path = require('path');
var npm = require('npm');
var Command = require('../command');
var ScriptRunner = require('../script-runner');

function CommandInstall() {
  Command.call(this, 'install');
}

util.inherits(CommandInstall, Command);

CommandInstall.prototype.execute = function() {
  var _this = this;

  var url = this.command.url;
  if (!url) {
    if (!this.command.module) {
      this.complete('error', 'module url not specified');
      return;
    }

    if (!this.command.outpost.config.registry) {
      this.complete('error', 'modules registry not configured');
      return;
    }

    // build the module url from the module name
    var module = this.manifest.parse(this.command.module);
    if (!module.version) {
      this.complete('error', 'module must be specified with version');
      return;
    }

    // the url has the form <registry>/module/module-version.tar.gz
    url = this.command.outpost.config.registry + '/' + module.name + '/' + module.name + '-' + module.version + '.tar.gz';
  }

  // download the module
  this._downloadModule(url, _this.command.outpost.config.modulesDir, function(result, msg) {
    _this.complete(result, msg);
  });
};

CommandInstall.prototype._downloadModule = function(url, unpackDir, cb) {
  var _this = this;
  this.manifest.moduleByUrl(url, function(err, module) {
    if (err) {
      cb('error', err);
      return;
    }

    if (module) {
      // we have an entry in the cache for the module. read the package.json.
      _this.logger.debug('found module ' + url + ' in cache manifest');
      _this._processModule(module, unpackDir, cb);
    } else {
      _this.logger.debug('did not find ' + url + ' in cache manifest. downloading module.');
      npm.commands.cache(['add', url], function(err, moduleData) {
        if (err) {
          cb('error', 'error downloading module from ' + url + ': ' + err);
          return;
        }
        _this.logger.debug('downloaded module from ' + url);
        _this.manifest.add(url, moduleData);
        _this.manifest.save(function(err) {
          if (err) {
            cb('error', err);
            return;
          }
          _this.manifest.moduleByUrl(url, function(err, module) {
            if (err) {
              cb('error', err);
              return;
            }
            _this._processModule(module, unpackDir, cb);
          });
        });
      });
    }
  });
};

CommandInstall.prototype._processModule = function(module, unpackDir, cb) {

  var moduleData = module.package.data;

  var _this = this;
  var targetDir = unpackDir + '/' + module.modulepath;

  // unpack this module to the target directory
  this._unpackModule(module, targetDir, function(err, unpacked) {
    if (err) {
      cb('error', err);
      return;
    }

    // download module dependencies and unpack them too
    var dependencies = moduleData && moduleData.deps || [];
    _this.logger.debug('processing module ' + module.fullname + ' dependencies: [' + dependencies + ']');
    function _download(index) {
      // run the installation script of this module only after all of the dependencies have been downloaded
      if (index === dependencies.length) {
        if (unpacked) {
          _this._install(module, targetDir, function(result, msg) {
            cb(result, msg);
          });
        } else {
          cb('skipped', 'already installed');
        }
        return;
      }
      _this._downloadModule(dependencies[index], targetDir + '/.modules', function(result, msg) {
        if (result === 'error') {
          cb(result, msg);
          return;
        }
        _download(index + 1);
      });
    }
    _download(0);
  });

};

CommandInstall.prototype._unpackModule = function(module, targetDir, cb) {

  // test if the directory exists
  var _this = this;
  fs.stat(targetDir, function(err, stat) {
    if (!err && stat) {
      // the directory exists, no need to unpack the module
      _this.logger.debug('module ' + module.fullname + ' already unpacked');
      cb(null, false);
    } else {
      // the directory probably does not exist. continue with unpacking
      npm.commands.cache.unpack(module.name, module.version, targetDir, function(err) {
        if (err) {
          cb('error unpacking module ' + module.fullname + ': ' + err);
          return;
        }
        _this.logger.debug('unpacked module ' + module.fullname + ' to ' + targetDir);
        cb(null, true);
      });
    }
  });

};

CommandInstall.prototype._install = function(module, targetDir, cb) {
  var moduleData = module.package.data;
  var installScript = moduleData && moduleData.scripts && moduleData.scripts.install;
  var installConfig = this.command.config;
  if (installScript) {
    var scriptName = path.resolve(targetDir, installScript);
    this.logger.debug('running install script for module ' + module.fullname);
    var runner = new ScriptRunner('install', module, scriptName, installConfig, targetDir, this.command.outpost);
    runner.run(cb);
  } else {
    cb('success', null);
  }
};

exports = module.exports = CommandInstall;

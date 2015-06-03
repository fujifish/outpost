var util = require('util');
var fs = require('fs');
var _url = require('url');
var path = require('path');
var npm = require('npm');
var Command = require('../command');
var ScriptRunner = require('../script-runner');

function CommandInstall() {
  Command.call(this);
}

util.inherits(CommandInstall, Command);

CommandInstall.prototype.execute = function() {
  var _this = this;

  if (!this.command.module) {
    this.complete('error', 'module not specified');
    return;
  }

  // download the module
  this._downloadModule(this.command.module, this.command.outpost.config.modulesDir, function(result, msg) {
    _this.complete(result, msg);
  });
};

CommandInstall.prototype._downloadModule = function(fullname, unpackDir, cb) {

  // translate to a url from the registry
  var registry = this.command.outpost.config.registry;
  if (!registry) {
    cb('error', 'modules registry is not configured');
    return;
  }

  var _this = this;
  this.cache.moduleByFullName(fullname, function(err, module) {
    if (err) {
      cb('error', err);
      return;
    }

    if (module) {
      // we have the module in the cache
      _this.logger.debug('found module ' + fullname + ' in the cache');
      _this._processModule(module, unpackDir, cb);
    } else {
      _this.logger.debug('did not find ' + fullname + ' in the cache. downloading module.');

      // build the module url from the module name
      var parts = _this.cache.parse(fullname);
      if (!parts.version) {
        cb('error', 'module must be specified with version');
        return;
      }

      // the url has the form <registry>/module/module-version
      // if the url protocol is not 'file:' then also append '.tar.gz'
      var protocol = _url.parse(registry).protocol;
      var suffix = (!protocol || protocol === 'file:') ? '' : '.tar.gz';
      var url = registry + '/' + parts.name + '/' + parts.name + '-' + parts.version + suffix;

      npm.commands.cache(['add', url], function(err, moduleData) {
        if (err) {
          cb('error', 'error downloading module from ' + url + ': ' + err);
          return;
        }
        _this.logger.debug('downloaded module ' + fullname);
        _this.cache.moduleByFullName(fullname, function(err, module) {
          if (err) {
            cb('error', err);
            return;
          }
          _this._processModule(module, unpackDir, cb);
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
    var dependencies = moduleData && moduleData.submodules || [];
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
      _this._downloadModule(dependencies[index], path.resolve(targetDir, '.outpost/modules'), function(result, msg) {
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
  fs.readdir(targetDir, function(err, files) {
    if (!err && files) {
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
        // create the outpost directory in the unpacked dir
        var outpostDir = path.resolve(targetDir, '.outpost');
        fs.mkdir(outpostDir, 0700, function(err) {
          if (err) {
            cb('error creating outpost dir ' + outpostDir + ': ' + err.message);
            return;
          }
          cb(null, true);
        });
      });
    }
  });

};

CommandInstall.prototype._install = function(module, targetDir, cb) {
  var moduleData = module.package.data;
  var installScript = moduleData && moduleData.scripts && moduleData.scripts.install;
  var installConfig = this.command.config;
  var state = this.command.outpost.state;

  // save the install state
  var _this = this;
  state.save(targetDir, 'install', {}, function(err) {
    if (err) {
      cb('error', 'error saving ' + module.fullname + ' install state: ' + err.message);
      return;
    }

    if (installScript) {
      var scriptName = path.resolve(targetDir, installScript);
      _this.logger.debug('running install script for module ' + module.fullname);
      var runner = new ScriptRunner('install', module, scriptName, installConfig, targetDir, _this.command.outpost);
      runner.run(cb);
    } else {
      cb('success', null);
    }
  });
};

exports = module.exports = CommandInstall;

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

CommandInstall.prototype._enrichModuleData = function(moduleData) {
  moduleData.fullname = moduleData.name + '@' + moduleData.version;
  return moduleData;
};

CommandInstall.prototype._processModule = function(moduleData, unpackDir, cb) {

  moduleData = this._enrichModuleData(moduleData);

  var _this = this;
  var targetDir = unpackDir + '/' + moduleData.fullname.replace('@', '-');

  // unpack this module to the target directory
  this._unpackModule(moduleData, targetDir, function(err) {
    if (err) {
      cb(err);
      return;
    }

    // download module dependencies and unpack them too
    var dependencies = moduleData.config && moduleData.config.modules || [];
    _this.logger.debug('processing module ' + moduleData.fullname + ' dependencies: [' + dependencies + ']');
    function _download(index) {
      // run the installation script of this module only after all of the dependencies have been downloaded
      if (index === dependencies.length) {
        _this._install(moduleData, targetDir, function(err, result) {
          cb(err, result);
        });
        return;
      }
      _this._downloadModule(dependencies[index], targetDir + '/_modules', function(err) {
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

CommandInstall.prototype._downloadModule = function(url, unpackDir, cb) {
  var _this = this;
  var module = this.manifest.moduleByUrl(url);
  if (module) {
    // we have an entry in the cache for the module. read the package.json.
    _this.logger.debug('found module ' + url + ' in cache manifest');
    var packageFile = this.command.outpost.config.cache + '/' + module.cachepath + '/package/package.json';
    fs.readFile(packageFile, function (err, moduleData) {
      if (err) {
        cb('error reading module package file ' + packageFile + ': ' + err);
        return;
      }
      _this._processModule(JSON.parse(moduleData), unpackDir, cb);
    });
  } else {
    _this.logger.debug('did not find ' + url + ' in cache manifest. downloading module.');
    npm.commands.cache(['add', url], function(err, moduleData) {
      if (err) {
        cb('error downloading module from ' + url + ': ' + err);
        return;
      }
      _this.logger.info('downloaded module from ' + url);
      _this.manifest.add(url, moduleData);
      _this.manifest.save(function(err) {
        if (err) {
          cb(err);
          return;
        }
        _this._processModule(moduleData, unpackDir, cb);
      });
    });
  }
};

CommandInstall.prototype._unpackModule = function(moduleData, targetDir, cb) {
  var _this = this;
  npm.commands.cache.unpack(moduleData.name, moduleData.version, targetDir, function(err) {
    if (err) {
      cb('error unpacking module ' + moduleData.fullname + ': ' + err);
      return;
    }
    _this.logger.info('unpacked module ' + moduleData.fullname + ' to ' + targetDir);
    cb(null);
  });
};

CommandInstall.prototype._install = function(moduleData, targetDir, cb) {
  var _this = this;
  var installScript = moduleData.config && moduleData.config.scripts && moduleData.config.scripts.install;
  var installParams = this.command.installParams || [];
  if (installScript) {
    var scriptName = path.resolve(targetDir, installScript);
    _this.logger.info('running install script for module ' + moduleData.fullname);
    var runner = new ScriptRunner(moduleData.fullname+':install', scriptName, installParams, targetDir);
    runner.run(cb);
  } else {
    this.logger.info('skipping install: module ' + moduleData.fullname + ' has no install script');
    cb(null, 'skipped');
  }
};

CommandInstall.prototype.execute = function() {
  var _this = this;

  var modules = _this.command.url || [];

  if (!Array.isArray(modules)) {
    modules = [modules];
  }

  function _download(index, result) {
    if (index === modules.length) {
      _this.complete(result, null);
      return;
    }

    // download the module
    _this._downloadModule(modules[index], _this.command.outpost.config.modules, function(err, result) {
      if (err) {
        _this.complete('error', err);
        return;
      }
      // download the next module
      _download(++index, result);
    });
  }

  _download(0);
};

exports = module.exports = CommandInstall;

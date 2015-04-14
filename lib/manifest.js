var fs = require('fs');
var path = require('path');
var Logger = require('./logger');

function Manifest(config) {
  this.config = config;
  this.manifest = {version: "1", modules:{}};
  this.logger = new Logger('outpost:manifest');
}

/**
 * load the cache manifest
 * @param cb receives the error if there was one
 */
Manifest.prototype.load = function(cb) {
  var _this = this;
  var manifestFile = this.config.cache + '/manifest';
  fs.exists(manifestFile, function(exists) {
    if (exists) {
      fs.readFile(manifestFile, function (err, data) {
        if (err) {
          cb('error reading cache manifest: ' + err);
          return;
        }
        _this.manifest = JSON.parse(data);
        cb(null);
      });
    } else {
      _this.logger.debug('cache manifest does not exist yet');
      cb(null);
    }
  });
};

/**
 * save the provided manifest as the cache manifest
 * @param cb receives the error if there was one
 */
Manifest.prototype.save = function(cb) {
  var manifestFile = this.config.cache + '/manifest';
  fs.writeFile(manifestFile, JSON.stringify(this.manifest), function (err) {
    cb(err);
  });
};

Manifest.prototype.add = function(url, moduleData) {
  var fullname = moduleData.name + '@' + moduleData.version;
  this.manifest.modules[fullname] = {
    url: url,
    name: moduleData.name,
    version: moduleData.version,
    fullname: fullname,
    cachepath: moduleData.name + '/' + moduleData.version,
    modulepath: moduleData.name + '-' + moduleData.version
  };
};

Manifest.prototype.moduleByName = function(fullname) {
  return this.manifest.modules[fullname];
};


Manifest.prototype.moduleByUrl = function(url) {
  var found = null;
  var modules = this.manifest.modules;
  Object.keys(modules).forEach(function(module) {
    if (!found && modules[module].url === url) {
      found = modules[module];
    }

  });
  return found;
};

exports = module.exports = Manifest;
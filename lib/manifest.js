var fs = require('fs');
var path = require('path');
var Logger = require('./logger');

/**
 * Manages the cache manifest containing metadata of all modules in the cache
 * @param outpost
 * @constructor
 */
function Manifest(outpost) {
  this.config = outpost.config;
  this.manifest = {version: "1", modules:{}};
  this.logger = new Logger('outpost:manifest', outpost.logger);
}

/**
 * load the cache manifest
 * @param cb receives the error if there was one
 */
Manifest.prototype.load = function(cb) {
  var _this = this;
  var manifestFile = this.config.cacheDir + '/manifest';
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
  var manifestFile = this.config.cacheDir + '/manifest';
  fs.writeFile(manifestFile, JSON.stringify(this.manifest), function (err) {
    cb(err);
  });
};

/**
 * parse a module full name into parts
 * @param fullname
 */
Manifest.prototype.parse = function(fullname) {
  if (fullname.indexOf('@') === -1) {
    fullname = fullname + '@';
  }
  var split = fullname.split('@');
  return {
    name: split[0],
    version: split[1]
  };
};

/**
 * Add a module downloaded from the specified url to the manifest
 * @param url
 * @param moduleData
 */
Manifest.prototype.add = function(url, moduleData) {
  var fullname = moduleData.name + '@' + moduleData.version;
  this.manifest.modules[fullname] = {
    url: url,
    name: moduleData.name,
    version: moduleData.version,
    fullname: fullname
  };
};

/**
 * Add information, including the module package data to the module metadata
 * @param module
 * @param cb
 * @private
 */
Manifest.prototype._enrich = function(module, cb) {
  if (!module) {
    cb(null, null);
    return;
  }

  if (module.package && module.package.data) {
    cb(null, module);
    return;
  }

  module.cachepath = module.name + '/' + module.version;
  module.modulepath = module.name + '-' + module.version;
  module.package = {
    file: this.config.cacheDir + '/' + module.cachepath + '/package/package.json',
    data: null
  };

  fs.readFile(module.package.file, function (err, data) {
    if (err) {
      cb('error reading module package file ' + module.package.file + ': ' + err);
      return;
    }
    if (typeof data !== 'string') {
      data = data.toString();
    }
    module.package.data = JSON.parse(data);
    cb(null, module);
  });
};

/**
 * Get a module by its full name
 * @param fullname the mudule fullname (e.g. module@1.0.0)
 * @param cb receives the module information or null if not found
 */
Manifest.prototype.moduleByName = function(fullname, cb) {
  this._enrich(this.manifest.modules[fullname], cb);
};

/**
 * Get a module by the url it was downloaded from
 * @param url the download url
 * @param cb receives the module information or null if not found
 */
Manifest.prototype.moduleByUrl = function(url, cb) {
  var found = null;
  var modules = this.manifest.modules;
  Object.keys(modules).forEach(function(module) {
    if (!found && modules[module].url === url) {
      found = modules[module];
    }
  });
  this._enrich(found, cb);
};

exports = module.exports = Manifest;
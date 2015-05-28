var fs = require('fs');
var path = require('path');
var Logger = require('./logger');

/**
 * Manages the modules cache
 * @param outpost
 * @constructor
 */
function Cache(outpost) {
  this.config = outpost.config;
  this.logger = new Logger('outpost:cache', outpost.logger);
}

/**
 * parse a module full name into parts
 * @param fullname
 */
Cache.prototype.parse = function(fullname) {
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
 * parse a module full name into parts
 * @param fullname
 */
Cache.prototype.isFullName = function(fullname) {
  return this.parse(fullname).version.length > 0;
};

/**
 * Add information, including the module package data to the module metadata
 * @param module
 * @param cb
 * @private
 */
Cache.prototype._enrich = function(module, cb) {
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
    file: path.resolve(this.config.cacheDir, module.cachepath + '/package/package.json'),
    data: null
  };

  fs.readFile(module.package.file, function(err, data) {
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
Cache.prototype.moduleByFullName = function(fullname, cb) {
  var parts = this.parse(fullname);
  if (!parts.version) {
    cb('module ' + parts.name + ' version not specified');
    return;
  }

  var _this = this;
  var modulepath = path.resolve(this.config.cacheDir, parts.name + '/' + parts.version);
  fs.readdir(modulepath, function(err, files) {
    if (err) {
      // if the directory doesn't exist, then we don't have the module in the cache
      if (err.code === 'ENOENT') {
        cb(null, null);
        return;
      }
      cb('error reading module directory ' + modulepath + ': ' + err.message);
      return;
    }

    // the directory exists, let's load the module information
    var module = {
      name: parts.name,
      version: parts.version,
      fullname: parts.name + '@' + parts.version
    };
    _this._enrich(module, cb);
  });
};

/**
 * Get all module versions by name
 * @param name the module name without the version (e.g. mymodule)
 * @param cb receives all available module versions
 */
Cache.prototype.moduleVersions = function(name, cb) {
  var modules = [];

  var _this = this;
  var basepath = path.resolve(this.config.cacheDir, name);
  fs.readdir(basepath, function(err, files) {
    if (err) {
      // if the directory doesn't exist, then we don't have any versions of the module in the cache
      if (err.code === 'ENOENT') {
        cb(null, []);
        return;
      }
      cb('error reading module directory ' + basepath + ': ' + err.message);
      return;
    }

    if (files.length === 0) {
      cb(null, []);
      return;
    }

    var count = files.length;
    files.forEach(function(version) {
      var module = {
        name: name,
        version: version,
        fullname: name + '@' + version
      };
      _this._enrich(module, function(err, m) {
        if (err) {
          _this.logger.warning('ignoring module ' + module.fullname + ': ' + err);
        } else {
          modules.push(m);
        }
        if (--count === 0) {
          cb && cb(null, modules);
        }
      });
    });
  });
};

/**
 * Get a module by searching for the installed version in the specified directory
 * @param name
 * @param dir
 * @param cb
 */
Cache.prototype.installedModule = function(name, dir, cb) {
  var _this = this;
  if (this.isFullName(name)) {
    // module has the form <module>@<version>
    this.moduleByFullName(name, function(err, module) {
      if (err) {
        cb(err);
        return;
      }

      if (!module) {
        cb('module ' + name +  ' not found');
        return;
      }

      cb(null, module);
    });
  } else {
    // module has the form <module> without any version
    _this.logger.debug('searching for installed module ' + name + ' in ' + dir);
    this.moduleVersions(name, function(err, versions) {

      if (err) {
        cb(err);
        return;
      }

      var foundModule = null;
      var foudnModuleDir;
      // we have a list of possible module versions. look for one (and only one) that's installed
      versions.forEach(function(module) {
        var moduleDir = path.resolve(dir, '.modules/' + module.modulepath);
        try {
          fs.readdirSync(moduleDir);
          // if we got here then the directory exists.
          // if we already have a version installed, then a full module+version must be specified to run the script
          if (foundModule) {
            cb && cb('multiple versions of module ' + name + ' are installed');
            cb = null;
            return;
          }
          foundModule = module;
          foudnModuleDir = moduleDir;
        } catch(err) {
          if (err.code !== 'ENOENT') {
            // if the error is that there is no directory then just ignore.
            // it simply means that this version is not installed
            cb && cb(err);
            cb = null;
          }
        }
      });

      if (!foundModule) {
        cb && cb('module ' + name +  ' not found');
        return;
      }

      // if we have one and only one module, then continue
      _this.logger.debug('found module ' + foundModule.fullname + ' in ' + dir);
      cb && cb(null, foundModule);
    });
  }
};

exports = module.exports = Cache;
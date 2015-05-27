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
 * parse a module full name into parts
 * @param fullname
 */
Manifest.prototype.isFullName = function(fullname) {
  return this.parse(fullname).version.length > 0;
};

/**
 * Add a module downloaded from the specified url to the manifest
 * @param url
 * @param moduleData
 */
Manifest.prototype.add = function(url, moduleData) {
  var versions = this.manifest.modules[moduleData.name] || {};
  versions[moduleData.version] = {
    url: url,
    name: moduleData.name,
    version: moduleData.version,
    fullname: moduleData.name + '@' + moduleData.version
  };
  this.manifest.modules[moduleData.name] = versions;
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

  try {
    var data = fs.readFileSync(module.package.file);
    if (typeof data !== 'string') {
      data = data.toString();
    }
    module.package.data = JSON.parse(data);
    cb(null, module);
  } catch (err) {
    cb('error reading module package file ' + module.package.file + ': ' + err);
  }
};

/**
 * Get a module by its full name
 * @param fullname the mudule fullname (e.g. module@1.0.0)
 * @param cb receives the module information or null if not found
 */
Manifest.prototype.moduleByFullName = function(fullname, cb) {
  var parts = this.parse(fullname);
  var versions = this.manifest.modules[parts.name];
  if (!versions) {
    cb(null, null);
    return;
  }
  this._enrich(versions[parts.version], cb);
};

/**
 * Get all module versions by name
 * @param name the module name without the version (e.g. mymodule)
 * @param cb receives all available the module versions
 */
Manifest.prototype.moduleVersions = function(name, cb) {
  var modules = [];
  var versions = this.manifest.modules[name];
  if (!versions) {
    cb(null, modules);
    return;
  }

  var _this = this;
  Object.keys(versions).forEach(function(version) {
    _this._enrich(versions[version], function(err, m) {
      if (err) {
        cb && cb(err);
        cb = null; // make sure not to call it again
        return;
      }
      modules.push(m);
    });
  });

  // _enrich is a synchronous operation
  cb && cb(null, modules);
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
    Object.keys(modules[module]).forEach(function(version) {
      if (!found && modules[module][version].url === url) {
        found = modules[module][version];
      }
    });
  });
  this._enrich(found, cb);
};

/**
 * Get a module by searching for the installed version in the specified directory
 * @param name
 * @param dir
 * @param cb
 */
Manifest.prototype.installedModule = function(name, dir, cb) {
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
    _this.logger.debug('searching for module ' + name + ' in ' + dir);
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

exports = module.exports = Manifest;
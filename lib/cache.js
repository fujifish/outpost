var http = require('http');
var https = require('https');
var fs = require('fs');
var path = require('path');
var _url = require('url');
var zlib = require('zlib');
var fse = require('fs-extra');
var tar = require('tar-fs');
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

  if (module.data) {
    cb(null, module);
    return;
  }

  module.cachepath = module.name + '/' + module.version;
  module.modulepath = module.name + '-' + module.version;
  module.datafile = path.resolve(this.config.cacheDir, module.cachepath + '/module.json');

  fs.readFile(module.datafile, function(err, data) {
    if (err) {
      cb('error reading module package file ' + module.datafile + ': ' + err);
      return;
    }

    if (typeof data !== 'string') {
      data = data.toString();
    }
    module.data = JSON.parse(data);
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
        // make sure the dir name ends with ".outpost"
        if (!dir.match(/\/\.outpost$/)) {
          dir = path.resolve(dir, '.outpost');
        }
        var moduleDir = path.resolve(dir, 'modules/' + module.modulepath);
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

/**
 * Download a module into the cache
 * @param fullname
 * @param force
 * @param cb
 */
Cache.prototype.download = function(fullname, force, cb) {

  if (typeof force === 'function') {
    cb = force;
    force = false;
  }

  // translate to a url from the registry
  var registry = this.config.registry;
  if (!registry) {
    cb('modules registry is not configured');
    return;
  }

  var _this = this;
  this.moduleByFullName(fullname, function(err, module) {
    if (err) {
      cb(err);
      return;
    }

    if (module && !force) {
      // we have the module in the cache
      cb(null, module);
      return;
    }


    // build the module url from the module name
    var parts = _this.parse(fullname);
    if (parts.version.length === 0) {
      cb('module version not specified');
      return;
    }

    _this.logger.debug('downloading module ' + fullname);

    // the url has the form <registry>/module/module-version
    // if the url protocol is not 'file:' then also append '.tgz'
    var protocol = _url.parse(registry).protocol;
    var suffix = (!protocol || protocol === 'file:') ? '' : '.tgz';
    var url = registry + '/' + parts.name + '/' + parts.name + '-' + parts.version + suffix;

    var downloader = null;
    if (protocol === 'http:') {
      downloader = http;
    } else if (protocol === 'https:') {
      downloader = https;
    }

    var targetCacheDir = path.resolve(_this.config.cacheDir, parts.name + '/' + parts.version);
    var tgz = path.resolve(targetCacheDir, 'module.tgz');

    function _downloaded() {
      _this.logger.debug('module ' + fullname + ' downloaded');
      // extract only the module.json
      _this._extract(tgz, targetCacheDir, ['module.json'], function() {
        _this.moduleByFullName(fullname, function(err, module) {
          if (err) {
            cb(err);
            return;
          }
          cb(null, module);
        });
      });
    }

    fse.mkdirs(targetCacheDir, function(err) {
      if (err) {
        cb('error creating cache dir ' + targetCacheDir + ': ' + err);
        return;
      }

      var tgzStream = fs.createWriteStream(tgz, {flags: 'w', mode: 0744});
      if (downloader) {
        downloader.get(url, function(res) {
          res.pipe(tgzStream);
        }).on('end', function() {
          _downloaded();
        }).on('error', function(e) {
          cb('error downloading module ' + fullname + ': ' + e.message);
        });
      } else {
        var pack = tar.pack(_url.parse(url).path).pipe(zlib.createGzip()).pipe(tgzStream);
        pack.on('close', function() {
          _downloaded();
        });
        pack.on('error', function(err) {
          cb('error tar packing module ' + fullname + ': ' + e.message);
        })
      }
    });
  });
};

/**
 * Unpack a module into the specified directory
 */
Cache.prototype.unpack = function(fullname, targetDir, cb) {
  var _this = this;
  this.moduleByFullName(fullname, function(err, module) {
    if (err) {
      cb(err);
      return;
    }

    var sourcePath = path.resolve(_this.config.cacheDir, module.cachepath + '/module.tgz');
    _this._extract(sourcePath, targetDir, cb);
  });
};

/**
 * Extract a tar gzipped file
 * @private
 */
Cache.prototype._extract = function(source, target, entries, cb) {
  if (typeof entries === 'function') {
    cb = entries;
    entries = null;
  }

  // entries is a list of file names to extract. if not provided then extract all files.
  if (entries) {
    entries = entries.map(function(e) {return path.resolve(target, e)});
  }

  // the tar extractor
  var extractor = tar.extract(target, {
    readable: true,
    writable: true,
    ignore: function(name) {
      return entries && entries.indexOf(name) === -1;
    }
  });
  extractor.on('error', function(err) {
    cb(err.message);
    cb = null;
  });
  extractor.on('finish', function() {
    setImmediate(function() {
      cb && cb();
      cb = null;
    });
  });

  // the file reader
  var reader = fs.createReadStream(source);
  reader.on('error', function(err) {
    cb(err.message);
    cb = null;
  });

  // the gunzipper
  var gunzip = zlib.createGunzip();
  gunzip.on('error', function(err) {
    cb(err.message);
    cb = null;
  });

  reader.pipe(gunzip).pipe(extractor);
};

exports = module.exports = Cache;
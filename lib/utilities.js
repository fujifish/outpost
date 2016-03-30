var fs = require('fs');
var path = require('path');

/**
 * Utility function to find a file by traveling up the file system
 * and checking every folder
 * @param filename
 * @param dir directory to look in. default is __dirname
 */
module.exports = exports = {

  findFile: function(filename, dir) {
    dir = dir || __dirname;

    // reached the root
    var parent = path.resolve(dir, '..');
    if (parent === dir) {
      return null;
    }

    try {
      var file = path.resolve(dir, filename);
      fs.openSync(file, 'r');
      return file;
    } catch (err) {
      if (err.code === 'ENOENT') {
        return this.findFile(filename, parent);
      }
      return null;
    }
  }
};

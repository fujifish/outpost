var fs = require('fs');
var os = require('os');
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

    var fd = null;
    try {
      var file = path.resolve(dir, filename);
      fd = fs.openSync(file, 'r');
      return file;
    } catch (err) {
      if (err.code === 'ENOENT') {
        return this.findFile(filename, parent);
      }
      return null;
    } finally {
      fd && fs.closeSync(fd);
    }
  },

  localIpAddress: function() {
    var localipaddress = 'unknown';
    try {
      var networkInterfaces = os.networkInterfaces();
      var faces = (networkInterfaces['eth0'] || networkInterfaces['en0'] || []).filter(function(iface) {
        return iface.family === 'IPv4';
      });
      localipaddress = faces && faces.length > 0 ? faces[0].address : 'unknown';
    } catch (e) {
      // ignore
    }
    return localipaddress;
  },

  runAs: function(runas) {
    var stat = fs.statSync(__filename);
    var user = runas;
    var group = user;
    if (user && user.indexOf(':') !== -1) {
      var userstr = user.split(':');
      user = userstr[0];
      group = userstr[1];
    }
    user = user || stat.uid;
    group = group || stat.gid;
    try {
      process.setgid(group);
      process.setuid(user);
      var home = process.env['HOME'];
      // set the home environment variable
      if (user === 'root' || user === 0) {
        home = '/root';
      } else if (typeof user === 'string') {
        home = '/home/' + user;
      } else {
        var passwd = fs.readFileSync('/etc/passwd', {encoding: 'utf8'}).split('\n');
        var matcher = new RegExp('^.+:'+user+':.+$');
        for (var i = 0; i < passwd.length; ++i) {
          if (matcher.test(passwd[i])) {
            home = '/home/' + passwd[i].split(':')[0];
            break;
          }
        }
      }
      process.env['HOME'] = home;
      return {
        group: group,
        user: user,
        home: home
      }
    } catch(e) {
      return {
        error: 'error running as user ' + user + ': ' + e.message
      };
    }
  }
};

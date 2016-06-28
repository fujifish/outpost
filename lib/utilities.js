var fs = require('fs');
var path = require('path');
var os = require('os');
var child = require('child_process');

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
    var localipaddress = null;
    try {
      var ifaces = os.networkInterfaces();
      var names = Object.keys(ifaces);
      for (var i = 0; i < names.length; ++i) {
        var iface = ifaces[names[i]];
        for (var j = 0; j < iface.length; ++j) {
          var face = iface[j];
          if (face.family === 'IPv4' && !face.internal) {
            localipaddress = face.address;
            break;
          }
        }
        if (localipaddress) {
          break;
        }
      }
    } catch (e) {
      // ignore
    }
    return localipaddress || 'unknown';
  },

  uidToName: function(uid) {
    try {
      var passwd = fs.readFileSync('/etc/passwd', {encoding: 'utf8'}).split('\n');
      var matcher = new RegExp('^.+:' + uid + ':.+$');
      for (var i = 0; i < passwd.length; ++i) {
        if (matcher.test(passwd[i])) {
          return passwd[i].split(':')[0];
        }
      }
    } catch(e) {
    }
    return uid;
  },

  runAs: function(runas) {
    // do not change current user unless running as root
    if (process.getuid() !== 0) {
      return {
        user: process.getuid(),
        group: process.getgid(),
        home: process.env['HOME']
      };
    }

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
        var username = this.uidToName(user);
        home = '/home/' + username;
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
  },

  exec: function(command, cb) {
    var proc = child.exec(command, function(err, stdout, stderr) {
      if (err) {
        return cb(err);
      }
      cb(null, stdout || '');
    });
  },


  diskspace: function(path, cb) {
    path = path || '/';
    this.exec('df -k ' + path, function(err, data) {
      if (err) {
        return cb({
          error: 'free diskspace calculation error: ' + err
        });
      }

      var lines = data.split('\n');
      if (lines.length < 2) {
        return cb({
          error: 'free diskspace calculation error: df command returned unparseable response: ' + data
        });
      }

      var info = lines[1].split(/\s+/);
      cb({
        path: path,
        total: parseInt(info[1]),
        used: parseInt(info[2]),
        available: parseInt(info[3]),
        usedPercent: info[4]
      });
    });
  }
};

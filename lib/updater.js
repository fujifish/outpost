var child = require('child_process');
var fs = require('fs');
var path = require('path');

var rootDir = process.argv[2];
var oldVersion = process.argv[3];
var newVersion = process.argv[4];

var oldDir = path.resolve(rootDir, 'outpost-'+oldVersion);
var currentDir = path.resolve(rootDir, 'outpost-current');
var newDir = path.resolve(rootDir, 'outpost-'+newVersion);

function log(level, message) {
  console.log('[' + new Date().toISOString() + '] ' + level.toUpperCase() + ' [updater] ' + message.trim());
}

function controlAgent(action, cb) {
  log('debug', action + ' agent');
  var agentCli = child.spawn(
    process.execPath,
    ['bin/outpost', 'agent', action],
    { cwd: currentDir,
      env: null,
      stdio: ['pipe', 'pipe', 'pipe']
    }
  );

  agentCli.stdout.on('data', function(data) {
    log('debug', data.toString());
  });

  agentCli.on('error', function(err) {
    log('error', 'failed to ' + action + ' agent: ' + err.message);
    cb && cb(err.message);
    cb = null;
  });

  agentCli.on('exit', function(code, signal) {
    if (code !== 0 || signal) {
      log('error', 'failed to ' + action + ' agent - exit status ' + code + ', signal ' + signal);
      cb && cb('exit code ' + code);
    } else {
      cb && cb();
    }
    cb = null;
  });

}

// stop the agent
controlAgent('stop', function(err) {
  if (err) {
    return;
  }
  // agent is stopped

  // rename directory 'outpost-current' => 'outpost-<oldversion>'
  try {
    log('debug', 'renaming ' + currentDir + ' to ' + oldDir);
    fs.renameSync(currentDir, oldDir);
  } catch (err) {
    log('error', 'failed to rename ' + currentDir + ' to ' + oldDir + ': ' + err.message);
    return;
  }

  // rename directory 'outpost-<newversion>' => 'outpost-current'
  try {
    log('debug', 'renaming ' + newDir + ' to ' + currentDir);
    fs.renameSync(newDir, currentDir);
  } catch (err) {
    log('error', 'failed to rename ' + newDir + ' to ' + currentDir + ': ' + err.message);
    // revert the renamed directory
    try {
      fs.renameSync(oldDir, currentDir);
    } catch (err) {
      log('error', 'update failed miserably (failed reverting ' + oldDir + ' back to ' + currentDir + '): ' + err.message);
      return;
    }
    // start the agent again
    controlAgent('start');
    return;
  }

  // directory renaming succeeded.
  // start the agent from the new location.
  controlAgent('start', function(err) {
    if (err) {
      return;
    }
    log('debug', 'outpost agent updated');
  });

});


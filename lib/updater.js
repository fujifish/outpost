var os = require('os');
var child = require('child_process');
var fs = require('fs');
var path = require('path');
var utilities = require('./utilities');
var Outpost = require('./outpost');

var rootDir = process.argv[2];
var oldVersion = process.argv[3];
var newVersion = process.argv[4];
var commandId = process.argv[5];

var oldDir = path.resolve(rootDir, 'outpost-'+oldVersion);
var currentDir = path.resolve(rootDir, 'outpost-current');
var newDir = path.resolve(rootDir, 'outpost-'+newVersion);

var opconfig = utilities.outpostConfig().opconfig;
var commandLogFile = path.resolve((opconfig && opconfig.root || os.tmpdir()), 'command.log');

function log(level, message) {
  let msg = '[' + new Date().toISOString() + '] ' + level.toUpperCase() + ' [updater] ' + message.trim();
  console.log(msg);

  if (commandId) {
    try {
      fs.writeFileSync(commandLogFile, `${msg}\n`, {encoding: 'utf8', flag: 'a'});
    } catch (e) {
      console.log(`failed to update ${commandLogFile}: ${e.message}`);
    }
  }
}

log('info', `updating outpost agent from ${oldVersion} to ${newVersion} (command id: ${commandId})`);

function nodeExec() {
  var exeName = process.platform === 'win32' ? 'node.exe' : 'node';
  var nodeFile = path.resolve(currentDir, path.join('node', process.platform, exeName));
  try {
    log('debug', 'looking for node executable at ' + nodeFile);
    fs.close(fs.openSync(nodeFile, 'r'));
    // success
    return nodeFile;
  } catch (err) {
    nodeFile = path.resolve(currentDir, path.join('node', exeName));
    try {
      log('debug', 'looking for node executable at ' + nodeFile);
      fs.close(fs.openSync(nodeFile, 'r'));
      // success
      return nodeFile;
    } catch (err) {
      nodeFile = path.resolve(currentDir, exeName);
      try {
        log('debug', 'looking for node executable at ' + nodeFile);
        fs.close(fs.openSync(nodeFile, 'r'));
        // success
        return nodeFile;
      } catch (err) {
        // no file, return the current node
        return process.execPath;
      }
    }
  }
}

function outpostAgentFile(){
  var agentFile = path.resolve(currentDir, './bin/agent');
  try {
    log('debug', 'looking for new bin/agent executable at ' + agentFile);
    fs.close(fs.openSync(agentFile, 'r'));
    // success
    return agentFile;
  } catch (err) {
    try {
      agentFile = path.resolve(currentDir, './bin/outpost');
      log('debug', 'looking for older bin/outpost executable at ' + agentFile);
      fs.close(fs.openSync(agentFile, 'r'));
      // success
      return agentFile;
    } catch (err) {
      log('error', 'failed to locate agent executable');
    }
  }
}

function controlAgent(action, cb) {
  log('debug', action + ' agent');
  var agentCli = child.spawn(
      nodeExec(),
    [outpostAgentFile(), 'agent', action],
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

function updateFortitude(result, msg) {
  if (commandId && commandId !== 'undefined') {
    let commandLog = undefined;
    try {
      commandLog = fs.readFileSync(commandLogFile, 'utf8');
    } catch (e) {
      log('error', `error reading ${commandLogFile}: ${e.message}`);
    }
    let outpost = new Outpost(opconfig);
    outpost.fortitude.updateCommand(commandId, {status: result, details: msg, log: commandLog}, function(err) {
      if (err) {
        log('error', `error updating command status: ${err}`);
      }
    });
  }
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
    let msg = 'failed to rename ' + currentDir + ' to ' + oldDir + ': ' + err.message;
    log('error', msg);
    updateFortitude('error', msg);
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
      log('debug', 'reverting: renaming ' + oldDir + ' to ' + currentDir);
      fs.renameSync(oldDir, currentDir);
    } catch (err) {
      let msg = '*** update failed miserably. OUTPOST AGENT NOT RUNNING *** (failed reverting ' + oldDir + ' back to ' + currentDir + '): ' + err.message;
      log('error', msg);
      updateFortitude('error', msg);
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
    log('debug', 'outpost agent updated to version ' + newVersion);
    updateFortitude('success', 'outpost agent updated to version ' + newVersion);
  });

});


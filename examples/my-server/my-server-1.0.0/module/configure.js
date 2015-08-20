outpost.log('Configuring MyServer');
outpost.template('config.json.tpl', outpost.config, 'config.json', function(err) {
  if (err) {
    outpost.fail(err);
  } else {
    outpost.done();
  }
});

console.log('node test-server is starting!');
process.title = 'node test-server';
var http = require('http');
var server = http.createServer();
server.listen(8778, function() {
  console.log('node test-server is listening!');
});

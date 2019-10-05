const http = require('http');
const uuidv4 = require('uuid/v4');
const { spawn } = require('child_process');
const fs = require('fs');
const AWS = require("aws-sdk");
const S3 = new AWS.S3({ apiVersion: '2006-03-01', region: 'us-west-2' });
const config = require('./config.json');

console.log(`using config`);
console.log(config);

const app = new http.Server();
const cache = {};

const ffmpegClip = ( start, end, input, output ) => {

  const id = uuidv4();

  cache[id] = { exit_code : null, log : '', input, output };

  const ffmpeg = spawn(
    'ffmpeg'
    , [ '-ss' , start , '-to' , end , '-i' , input , '-f', 'mp3', '-' ]
  );

  const params = {
    Bucket: config.s3_bucket
    , Key: output
    , Body: ffmpeg.stdout
  };

  const options = {
    partSize: 10 * 1024 * 1024
    , queueSize: 1
  };

  S3.upload(params, options, (err, data) => cache[id].log += (err || data));

  ffmpeg.stderr.on('data', data => cache[id].log += data );
  ffmpeg.on('close', code => cache[id].exit_code = code );

  return id;
};

app.on('request', (req, res) => {

  const path = req.url.split('/').filter(x => Boolean(x));

  if( req.method === 'GET' ){
    if (path.length === 0) {
      res.writeHead(200, { 'Content-Type': 'text/json' });
      res.write(JSON.stringify({
        status : 200
        , processes : Object.keys(cache).map(x => ({
          id : x
          , input : cache[x].input
          , output : cache[x].output
          , exit_code : cache[x].exit_code 
        }))
      }));
    } else if (path.length === 1 && cache.hasOwnProperty(path[0]) ){
      res.writeHead(200, { 'Content-Type': 'text/json' });
      res.write(JSON.stringify({ status : 200, process: cache[path[0]] }));
    } else {
      res.writeHead(404, { 'Content-Type': 'text/json' });
      res.write(JSON.stringify({ status : 404, text : 'id not recognized' }));
    }
  } else if ( req.method === 'POST' ){

    const chunks = [];
    
    req.on('data', (chunk) => {
      chunks.push(chunk);
    });
    
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString());
      ffmpegClip( body.start, body.end, body.input, 'myFile.mp3' );
    });

    res.writeHead(200, { 'Content-Type': 'text/json' });
    res.write(JSON.stringify({ status : 200 }));

  } else {
    res.writeHead(404, { 'Content-Type': 'text/json' });
    res.write(JSON.stringify({ status : 404, text : 'resource not found' }));
  }

  res.end();
});

app.listen(
  config.port
  , () => console.log(`App listening on port ${config.port}`)
);

import chalk from 'chalk';
import format from 'date-fns/format/index.js';
import dotenv from 'dotenv'
import fs from 'fs'
import http from 'http'
import { Octokit, App } from 'octokit'
import { createAppAuth } from '@octokit/auth-app'
import { request } from '@octokit/request'
import { createNodeMiddleware } from '@octokit/webhooks'

// Load environment variables from .env file
dotenv.config()

// Set configured values
const appId = process.env.APP_ID;
const privateKeyPath = process.env.PRIVATE_KEY_PATH;
const privateKey = fs.readFileSync(privateKeyPath, 'utf8');
const secret = process.env.WEBHOOK_SECRET;
const installationId = process.env.INSTALLATION_ID
// const messageForNewPRs = fs.readFileSync('./message.md', 'utf8')

// Create an authenticated Octokit client authenticated as a GitHub App
const app = new App({
  appId,
  privateKey,
  webhooks: {
    secret
  }
});

const auth = createAppAuth({ appId, id: 1, privateKey, installationId });

const requestWithAuth = request.defaults({
  request: {
    hook: auth.hook,
  }
});

// Optional: Get & log the authenticated app's name
const appInfoRequest = await app.octokit.request('/app')
const appData = appInfoRequest.data;

// Read more about custom logging: https://github.com/octokit/core.js#logging
app.octokit.log.debug(`Authenticated as '${appData.name}'`)

// Subscribe to the "pull_request.opened" webhook event
app.webhooks.onAny(async (event) => {
  console.log(event);
});
// app.webhooks.on('pull_request.opened', async ({ octokit, payload }) => {
//   console.log(`Received a pull request event for #${payload.pull_request.number}`)
//   try {
//     // await octokit.rest.issues.createComment({
//     //   owner: payload.repository.owner.login,
//     //   repo: payload.repository.name,
//     //   issue_number: payload.pull_request.number,
//     //   body: messageForNewPRs
//     // })
//   } catch (error) {
//     if (error.response) {
//       console.error(`Error! Status: ${error.response.status}. Message: ${error.response.data.message}`)
//     } else {
//       console.error(error)
//     }
//   }
// })

// Optional: Handle errors
app.webhooks.onError((error) => {
  if (error.name === 'AggregateError') {
    // Log Secret verification errors
    console.log(`Error processing request: ${error.event}`)
  } else {
    console.log(error)
  }
})

// Launch a web server to listen for GitHub webhooks
const port = process.env.PORT || 5000
const path = '/api/webhook'
const localWebhookUrl = `http://localhost:${port}${path}`

// See https://github.com/octokit/webhooks.js/#createnodemiddleware for all options
const middleware = createNodeMiddleware(app.webhooks, { path })

http.createServer(middleware).listen(port, () => {
  console.log(`${chalk.greenBright('WEBHOOK SERVER')} is listening for events at: ${chalk.greenBright(localWebhookUrl)}`)
})

// Create a local server to handle PROJECT REQ
const projectPort = 8000;
const projectPath = "/projects";
const localProjectServerUrl = `http://localhost:${projectPort}${projectPath}`
http.createServer(async (req, res) => {
  console.log(`${req.method} : ${req.url} -- ${format(Date.now(), 'PPPpp')}`);

  const localUrl = `http://localhost:${projectPort}${req.url}`
  const url = new URL(localUrl);

  if (url.pathname === '/repos' && req.method === 'GET') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Request-Method', '*');
    res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const repos = [];

    app.eachRepository(({ octokit, repository }) => {
      repos.push({
        description: repository.description,
        id: repository.id,
        name: repository.name,
        owner: { id: repository.owner.id, login: repository.owner.login, type: repository.owner.type },
        private: repository.private,
        url: repository.url,
      });
    }).then(() => {
      res.end(JSON.stringify({
        id: appData.id,
        repos,
      }));
    }).catch((error) => error ?? console.error(error));

    return;
  }

  if (url.pathname === '/repo' && req.method === 'GET') {
    const owner = url.searchParams.get('owner');
    const repo = url.searchParams.get('repo');
    const path = 'README.md';

    try {
      const result = await requestWithAuth(`GET /repos/${owner}/${repo}/contents/${path}`)
      const content = Buffer.from(result.data.content, 'base64').toString();
      console.log({ content })

      res.setHeader('Access-Control-Allow-Origin', '*') // TODO - Change this for security
      res.writeHead(200);
      res.end(JSON.stringify({ content }));
      return;
    } catch (error) {
      console.error(error);
      res.writeHead(500);
      res.end(JSON.stringify({ error }));
      return;
    }
  }

  res.writeHead(401);
  res.end();
  return;
}).listen(8000, () => {
  console.log(`${chalk.yellowBright('PROJECT SERVER')} is listening for requests at: ${chalk.yellowBright(localProjectServerUrl)}`);
  console.log('Press Ctrl + C to quit.\n')
})

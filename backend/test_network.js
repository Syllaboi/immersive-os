const Docker = require('dockerode');
const docker = new Docker({ socketPath: '/var/run/docker.sock' });
docker.listNetworks().then(networks => console.log(networks.map(n => n.Name)));

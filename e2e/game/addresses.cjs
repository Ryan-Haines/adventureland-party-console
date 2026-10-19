const gameHosts = ['127.0.0.1','127.0.0.2','127.0.0.3','127.0.0.4'];
const isLoopback = host => [...gameHosts,'localhost','::1','[::1]'].includes(host);
module.exports = {gameHosts,isLoopback};

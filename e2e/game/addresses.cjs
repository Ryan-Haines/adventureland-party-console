const gameHosts = Array.from({length:16},(_,index)=>`127.0.0.${index+1}`);
const isLoopback = host => [...gameHosts,'localhost','::1','[::1]'].includes(host);
module.exports = {gameHosts,isLoopback};

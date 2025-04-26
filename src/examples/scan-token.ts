import { TokenScanner } from '../scanner/token-scanner';

async function main() {
  const TOKEN_ADDRESS = '4qo7Jqwio9EtQDby7rLdG6Qz1coK6c32HCNnYNLvPump';
  //      Ht5BNRYc1ho2vi6a82TR8fngSC268MRncVFqcW3LZY3g //2TBpuWr1at8wu7edguKebFVV9BrvbuMjTRwp34H38SV8
  const SCAN_ADDRESS = '9Z32admygc42hoXeBc291eApZmb1tdnNmr377SJmnQzg';
  const scanner = new TokenScanner(TOKEN_ADDRESS, SCAN_ADDRESS);
  await scanner.startScanning();
}

main().catch(console.error);

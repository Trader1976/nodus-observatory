/* Network-specific identities live here. Moving between testnets changes this
 * profile, not the lending UI. Deployments and balances never move with it.
 * Only a documented test-token deployment is enabled; unknown assets stay null.
 */
(() => {
  'use strict';
  const profiles = {
    nile: Object.freeze({
      key: 'nile', name: 'TRON Nile', chainId: '0xcd8690dc',
      rpc: 'https://nile.trongrid.io', explorer: 'https://nile.tronscan.org',
      faucet: 'https://nileex.io/join/getJoinPage',
      token: Object.freeze({address: 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf', symbol: 'test USDT', decimals: 6}),
      settlement: null,
    }),
    shasta: Object.freeze({
      key: 'shasta', name: 'TRON Shasta', chainId: '0x94a9059e',
      rpc: 'https://api.shasta.trongrid.io', explorer: 'https://shasta.tronscan.org',
      faucet: 'https://shasta.tronex.io/join/getJoinPage',
      token: null, settlement: null,
    }),
  };
  globalThis.NodusDefiNetworks = Object.freeze({defaultNetwork: 'nile', profiles: Object.freeze(profiles)});
})();

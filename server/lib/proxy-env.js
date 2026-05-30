import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

// 纯函数，从 env 中解析代理配置（可独立测试）
export function resolveProxyConfig(env = process.env) {
  const allProxy = env.all_proxy || env.ALL_PROXY;
  return {
    httpProxy: env.http_proxy || env.HTTP_PROXY || allProxy || undefined,
    httpsProxy: env.https_proxy || env.HTTPS_PROXY || allProxy || undefined,
    noProxy: env.no_proxy || env.NO_PROXY || undefined,
  };
}

// 关键坑位：setGlobalDispatcher 只对"userland undici 包"这一实例的全局 dispatcher 生效，
// 而代理转发上游用的是 Node 内置全局 fetch（背后是 Node 自带的另一份 undici），两份 undici
// 的 global dispatcher 互不相通。所以单靠 setGlobalDispatcher，代理转发的请求不会读
// http_proxy/https_proxy，会直连 api.anthropic.com，绕过用户的网络代理。
// 解法：把这里构造的 EnvHttpProxyAgent 显式保存下来，由 proxy 转发处作为 fetch 的
// dispatcher 选项传入（Node 内置 fetch 接受 userland undici 的 dispatcher 实例）。
let _proxyDispatcher = null;

export function setupProxyEnv() {
  const { httpProxy, httpsProxy, noProxy } = resolveProxyConfig();
  if (!httpProxy && !httpsProxy) return;

  _proxyDispatcher = new EnvHttpProxyAgent({ httpProxy, httpsProxy, noProxy });
  setGlobalDispatcher(_proxyDispatcher); // 仍保留：覆盖直接 import 'undici' 的 fetch 调用路径
  if (process.env.CCV_DEBUG) {
    console.error(`[CC Viewer] HTTP proxy: http=${httpProxy || '(none)'}, https=${httpsProxy || '(none)'}${noProxy ? `, no_proxy=${noProxy}` : ''}`);
  }
}

// 返回供"内置全局 fetch"使用的代理 dispatcher；无代理配置时返回 null（调用方不传即直连）。
export function getProxyDispatcher() {
  return _proxyDispatcher;
}

setupProxyEnv();

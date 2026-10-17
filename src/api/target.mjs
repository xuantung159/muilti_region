// Chặn proxy gọi vào mạng nội bộ (SSRF). Kiểm tra diễn ra lúc mở kết nối, trên chính địa chỉ IP
// được dùng để kết nối, nên tên miền đổi IP giữa lúc kiểm tra và lúc kết nối (DNS rebinding) cũng bị chặn.
import { lookup as dnsLookup } from 'node:dns';
import { BlockList, isIP } from 'node:net';

const blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blocked.addSubnet(network, prefix, 'ipv4');
// IPv6: loopback/unspecified, NAT64, 6to4, Teredo, tài liệu, ULA, link-local, site-local, multicast.
// Không thêm ::ffff:0:0/96: BlockList tự so địa chỉ IPv4-mapped với luật IPv4, thêm vào sẽ chặn mọi IPv4.
for (const [network, prefix] of [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64],
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
]) blocked.addSubnet(network, prefix, 'ipv6');

export const isBlockedAddress = address => {
  const family = isIP(address);
  return !family || blocked.check(address, family === 4 ? 'ipv4' : 'ipv6');
};

export class TargetBlockedError extends Error {
  code = 'TARGET_BLOCKED';
}

// Dùng làm option `lookup` của https.request: chỉ trả về địa chỉ khi mọi IP của tên miền đều công khai.
export function safeLookup(hostname, options, callback) {
  if (typeof options === 'function') [callback, options] = [options, {}];
  dnsLookup(hostname, { ...options, all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err);
    if (!addresses.length || addresses.some(({ address }) => isBlockedAddress(address))) {
      return callback(new TargetBlockedError(`Đích ${hostname} trỏ tới địa chỉ không được phép`));
    }
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}

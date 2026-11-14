#!/usr/bin/env python3
"""Retry phía hạ tầng bằng CloudFront origin failover cho /proxy/* của distribution mrapi-web.

Luồng sau khi bật:
  client -> app.multi-region.io.vn/proxy/* -> CloudFront Function mrapi-proxy-failover (viewer-request)
  GET/HEAD/OPTIONS: hàm tạo origin group cho request này
         -> origin chính  mrapi-api-latency-fo (api.multi-region.io.vn, Route 53 latency chọn Region)
         -> nếu trả 500/502/503 hoặc không kết nối được: gửi lại ngay sang mrapi-api-tyo (execute-api Tokyo, /demo)
  POST/PUT/PATCH/DELETE: đi tới origin của behavior (mrapi-api-latency) như cũ, không gửi lại.

Không gắn origin group cố định vào behavior: CloudFront từ chối behavior cho phép POST/PUT/DELETE
trỏ tới origin group ("AllowedMethods cannot include POST, PUT, PATCH, or DELETE ... origin group").

Chạy trong CloudShell (python3 + boto3 có sẵn), cùng thư mục với mrapi-proxy-failover.js:
  python3 origin-failover.py plan       # in thay đổi, không sửa gì
  python3 origin-failover.py apply      # tạo/publish function, thêm 2 origin, gắn function vào /proxy/*
  python3 origin-failover.py rollback   # gỡ function khỏi /proxy/*, xóa 2 origin, xóa function
  python3 origin-failover.py status
"""
import copy
import json
import os
import sys

DIST_ID = 'E33WCNP66CDRPQ'
PATH = '/proxy/*'
BEHAVIOR_ORIGIN = 'mrapi-api-latency'     # origin của /proxy/*, giữ nguyên (request ghi vẫn đi đây)
PRIMARY_ID = 'mrapi-api-latency-fo'       # cùng domain chung, timeout ngắn để failover nhanh khi mất kết nối
SECONDARY_ID = 'mrapi-api-tyo'
FUNCTION_NAME = 'mrapi-proxy-failover'
FUNCTION_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mrapi-proxy-failover.js')
OLD_CACHED_METHODS = ['HEAD', 'GET']
# CloudFront chỉ failover khi OPTIONS nằm trong cached methods; cache vẫn tắt (Managed-CachingDisabled).
NEW_CACHED_METHODS = ['HEAD', 'GET', 'OPTIONS']


def custom_origin(origin_id, domain, origin_path, attempts, timeout):
    return {
        'Id': origin_id,
        'DomainName': domain,
        'OriginPath': origin_path,
        'CustomHeaders': {'Quantity': 0},
        'CustomOriginConfig': {
            'HTTPPort': 80,
            'HTTPSPort': 443,
            'OriginProtocolPolicy': 'https-only',
            'OriginSslProtocols': {'Quantity': 1, 'Items': ['TLSv1.2']},
            'OriginReadTimeout': 30,
            'OriginKeepaliveTimeout': 5,
            'IpAddressType': 'ipv4',
        },
        # Mặc định 3 lần x 10 s = 30 s mới failover khi Region mất kết nối; hạ còn 2 x 3 s.
        'ConnectionAttempts': attempts,
        'ConnectionTimeout': timeout,
        'OriginShield': {'Enabled': False},
        'OriginAccessControlId': '',
    }


NEW_ORIGINS = [
    custom_origin(PRIMARY_ID, 'api.multi-region.io.vn', '', 2, 3),
    custom_origin(SECONDARY_ID, 'n39r5pits8.execute-api.ap-northeast-1.amazonaws.com', '/demo', 2, 3),
]


def behavior(cfg):
    items = cfg.get('CacheBehaviors', {}).get('Items', [])
    found = [b for b in items if b['PathPattern'] == PATH]
    if len(found) != 1:
        raise SystemExit(f'Không tìm thấy đúng 1 behavior {PATH}')
    return found[0]


def set_list(holder, key, items):
    holder[key] = {'Quantity': len(items), 'Items': items} if items else {'Quantity': 0}


def is_ours(assoc):
    return assoc['FunctionARN'].split('/')[-1] == FUNCTION_NAME


def apply(cfg, function_arn):
    cfg = copy.deepcopy(cfg)
    origins = cfg['Origins']['Items']
    if BEHAVIOR_ORIGIN not in {o['Id'] for o in origins}:
        raise SystemExit(f'Không có origin {BEHAVIOR_ORIGIN}; cấu hình khác với bản đã ghi trong repo, dừng lại.')
    for o in NEW_ORIGINS:
        origins[:] = [x for x in origins if x['Id'] != o['Id']] + [copy.deepcopy(o)]
    set_list(cfg, 'Origins', origins)
    b = behavior(cfg)
    if b['TargetOriginId'] != BEHAVIOR_ORIGIN:
        raise SystemExit(f'{PATH} đang trỏ {b["TargetOriginId"]}, không phải {BEHAVIOR_ORIGIN}; dừng lại.')
    set_list(b['AllowedMethods'], 'CachedMethods', list(NEW_CACHED_METHODS))
    assocs = [a for a in b['FunctionAssociations'].get('Items', []) if not is_ours(a)]
    if any(a['EventType'] == 'viewer-request' for a in assocs):
        raise SystemExit(f'{PATH} đã có function viewer-request khác; dừng lại.')
    assocs.append({'FunctionARN': function_arn, 'EventType': 'viewer-request'})
    set_list(b, 'FunctionAssociations', assocs)
    return cfg


def rollback(cfg):
    cfg = copy.deepcopy(cfg)
    b = behavior(cfg)
    set_list(b['AllowedMethods'], 'CachedMethods', list(OLD_CACHED_METHODS))
    set_list(b, 'FunctionAssociations', [a for a in b['FunctionAssociations'].get('Items', []) if not is_ours(a)])
    set_list(cfg, 'Origins', [o for o in cfg['Origins']['Items'] if o['Id'] not in (PRIMARY_ID, SECONDARY_ID)])
    return cfg


def summary(cfg):
    b = behavior(cfg)
    return {
        'behavior /proxy/*': b['TargetOriginId'],
        'allowed methods': len(b['AllowedMethods']['Items']),
        'cached methods': b['AllowedMethods']['CachedMethods'].get('Items', []),
        'functions /proxy/*': [f"{a['EventType']}: {a['FunctionARN'].split('/')[-1]}" for a in b['FunctionAssociations'].get('Items', [])],
        'origins': [f"{o['Id']} -> {o['DomainName']}{o['OriginPath']} (attempts {o['ConnectionAttempts']}, timeout {o['ConnectionTimeout']}s)"
                    for o in cfg['Origins']['Items']],
    }


def ensure_function(cf, code):
    """Tạo hoặc cập nhật function, test, publish lên LIVE. Trả ARN."""
    config = {'Comment': 'Origin failover cho /proxy/* (GET/HEAD/OPTIONS)', 'Runtime': 'cloudfront-js-2.0'}
    try:
        etag = cf.describe_function(Name=FUNCTION_NAME, Stage='DEVELOPMENT')['ETag']
        etag = cf.update_function(Name=FUNCTION_NAME, IfMatch=etag, FunctionConfig=config, FunctionCode=code)['ETag']
        print('Đã cập nhật function', FUNCTION_NAME)
    except cf.exceptions.NoSuchFunctionExists:
        etag = cf.create_function(Name=FUNCTION_NAME, FunctionConfig=config, FunctionCode=code)['ETag']
        print('Đã tạo function', FUNCTION_NAME)
    for method in ('GET', 'POST'):
        event = {'version': '1.0', 'context': {'eventType': 'viewer-request'}, 'viewer': {'ip': '1.2.3.4'},
                 'request': {'method': method, 'uri': '/proxy/x/get', 'querystring': {}, 'headers': {}, 'cookies': {}}}
        r = cf.test_function(Name=FUNCTION_NAME, IfMatch=etag, Stage='DEVELOPMENT', EventObject=json.dumps(event).encode())['TestResult']
        if r.get('FunctionErrorMessage'):
            raise SystemExit(f'Test function lỗi ({method}): {r["FunctionErrorMessage"]}')
        print(f'Test {method}: OK, compute {r.get("ComputeUtilization")}%')
    cf.publish_function(Name=FUNCTION_NAME, IfMatch=etag)
    return cf.describe_function(Name=FUNCTION_NAME, Stage='LIVE')['FunctionSummary']['FunctionMetadata']['FunctionARN']


def wait_deployed(cf):
    print('Chờ distribution Deployed (thường 2-5 phút)...')
    cf.get_waiter('distribution_deployed').wait(Id=DIST_ID, WaiterConfig={'Delay': 20, 'MaxAttempts': 45})
    print('Deployed.')


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else 'plan'
    if action not in ('plan', 'apply', 'rollback', 'status'):
        raise SystemExit(__doc__)
    import boto3
    cf = boto3.client('cloudfront')
    res = cf.get_distribution_config(Id=DIST_ID)
    cfg, etag = res['DistributionConfig'], res['ETag']
    print('HIỆN TẠI:', json.dumps(summary(cfg), indent=2, ensure_ascii=False))
    if action == 'status':
        print('Trạng thái distribution:', cf.get_distribution(Id=DIST_ID)['Distribution']['Status'])
        return
    if action == 'rollback':
        new = rollback(cfg)
        print('SAU KHI ROLLBACK:', json.dumps(summary(new), indent=2, ensure_ascii=False))
        cf.update_distribution(Id=DIST_ID, IfMatch=etag, DistributionConfig=new)
        wait_deployed(cf)
        try:
            fetag = cf.describe_function(Name=FUNCTION_NAME, Stage='DEVELOPMENT')['ETag']
            cf.delete_function(Name=FUNCTION_NAME, IfMatch=fetag)
            print('Đã xóa function', FUNCTION_NAME)
        except cf.exceptions.NoSuchFunctionExists:
            pass
        return
    code = open(FUNCTION_FILE, 'rb').read()
    placeholder = f'arn:aws:cloudfront::000000000000:function/{FUNCTION_NAME}'
    preview = apply(cfg, placeholder)
    print('SAU KHI APPLY:', json.dumps(summary(preview), indent=2, ensure_ascii=False))
    if action == 'plan':
        print('\nChỉ in thay đổi. Chạy "python3 origin-failover.py apply" để áp dụng.')
        return
    arn = ensure_function(cf, code)
    cf.update_distribution(Id=DIST_ID, IfMatch=etag, DistributionConfig=apply(cfg, arn))
    wait_deployed(cf)


if __name__ == '__main__':
    main()

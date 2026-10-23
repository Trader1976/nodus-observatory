"""The actual HTTP trust boundary, beyond board/network function tests."""
from functools import partial
import http.client
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from collector import DEFAULTS
from server import Handler

class TradeHttpTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.config=dict(DEFAULTS,state_dir=self.temp.name,frontend_dir=self.temp.name)
        self.server=ThreadingHTTPServer(('127.0.0.1',0),partial(Handler,config=self.config))
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.host='127.0.0.1:'+str(self.server.server_port)
        self.now=int(time.time())
        self.listing={'schema':'nodus-trade/listing-v1','id':'0x'+'11'*32,'name':'One whole offer','side':'sell_nodus','nodusAmount':'1000','usdtAmount':'10','maker':{'nodus':'0x'+'22'*32,'bsc':'0x'+'33'*20},'asset':{'kind':'bep20','chainId':97,'token':'0x'+'44'*20,'decimals':18,'symbol':'TEST-USDT'},'createdAt':self.now,'expiresAt':self.now+3600}
    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join();self.temp.cleanup()
    def request(self,path,method='GET',payload=None,headers=None,raw=None):
        connection=http.client.HTTPConnection('127.0.0.1',self.server.server_port,timeout=5)
        body=raw if raw is not None else json.dumps(payload) if payload is not None else None
        h={'Content-Type':'application/json',**(headers or {})}
        connection.request(method,path,body=body,headers=h)
        response=connection.getresponse();data=json.loads(response.read());status=response.status;connection.close();return status,data
    def auth(self):
        status,board=self.request('/api/trade/board');self.assertEqual(status,200)
        return {'Origin':'http://'+self.host,'X-CSRF-Token':board['csrfToken']}
    def test_shared_board_flow_and_caps_are_not_public(self):
        headers=self.auth()
        status,created=self.request('/api/trade/listings','POST',self.listing,headers);self.assertEqual(status,200)
        status,board=self.request('/api/trade/board');self.assertEqual(status,200);self.assertEqual(len(board['listings']),1)
        self.assertNotIn(created['managementToken'],json.dumps(board));self.assertNotIn('cap_hash',json.dumps(board))
        status,reserved=self.request('/api/trade/reserve','POST',{'id':self.listing['id'],'taker':{'nodus':'0x'+'55'*32,'bsc':'0x'+'66'*20}},headers);self.assertEqual(status,200)
        status,_=self.request('/api/trade/cancel','POST',{'id':self.listing['id'],'managementToken':created['managementToken']},headers);self.assertEqual(status,409)
    def test_write_boundary_and_unknown_secrets(self):
        headers=self.auth()
        for h in ({}, {'Origin':'https://attacker.example','X-CSRF-Token':headers['X-CSRF-Token']},{'Origin':headers['Origin'],'X-CSRF-Token':'wrong'}):
            self.assertEqual(self.request('/api/trade/listings','POST',self.listing,h)[0],403)
        self.assertEqual(self.request('/api/trade/listings','POST',{**self.listing,'secret':'must-not-be-stored'},headers)[0],400)
        duplicate=json.dumps(self.listing)[:-1]+',"name":"second"}'
        self.assertEqual(self.request('/api/trade/listings','POST',headers=headers,raw=duplicate)[0],400)
        self.assertEqual(self.request('/api/trade/listings?x=1','POST',self.listing,headers)[0],405)
        self.assertEqual(self.request('/api/trade/observe','POST',{},headers)[0],405)
        self.assertEqual(self.request('/api/trade/listings','DELETE',{},headers)[0],405)
        self.assertEqual(self.request('/api/trade/board?x=1')[0],400)
        self.assertEqual(self.request('/api/trade/board',headers={'Host':'attacker.example'})[0],403)
        self.assertEqual(self.request('/api/trade/board')[1]['listings'],[])
    def test_observation_route_is_read_only_and_preserves_unverified(self):
        payload={'schema':'nodus-trade/observation-v1','available':True,'confirmed':False,'runtime':None,'blocker':'nodus_runtime_unavailable'}
        with patch('trade_network.lookup',return_value=(payload,200)) as lookup:
            status,data=self.request('/api/trade/observe?chain=nodus&contract=x&funder=y&trade_id=z')
        self.assertEqual(status,200);self.assertFalse(data['confirmed']);self.assertIsNone(data['runtime'])
        self.assertEqual(lookup.call_args.args[1]['chain'],['nodus'])

if __name__=='__main__':unittest.main()

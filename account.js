// 토지한눈: 공통 Cloudflare SNS 로그인만 연동합니다. 관심 토지의 로컬 자료는 전송하지 않습니다.
// Firebase Auth/Firestore 또는 기존 공통 Firebase 계정 SDK는 불러오지 않습니다.
import {createCloudflareAccountClient} from 'https://softm.github.io/services/cloudflare-account/src/client.mjs?v=20261113-native-auth-1';
import {mountSiteAccount} from 'https://softm.github.io/shared/platform/v1/account-menu.mjs?v=20261030-menu-1';

const SITE_ID='tojihannun';
const WORKER_ORIGIN='https://softm-hannun-account.softm.workers.dev';
const client=createCloudflareAccountClient({baseUrl:WORKER_ORIGIN,siteId:SITE_ID});
const listeners=new Set();
const notify=()=>{for(const listener of listeners)listener(client.currentUser);};

const account={
  siteId:SITE_ID,
  accountPageUrl:WORKER_ORIGIN+'/account',
  externalBrowser:false,
  get currentUser(){return client.currentUser;},
  subscribe(listener){
    if(typeof listener!=='function')throw new TypeError('계정 상태 구독 함수가 필요합니다.');
    listeners.add(listener);listener(client.currentUser);
    return ()=>listeners.delete(listener);
  },
  async ready(){return client;},
  async login({popup,mode='login'}={}){
    try {return await client.login({popup,mode});}
    finally {notify();}
  },
  async logout(){
    try {await client.logout();}
    finally {notify();}
  }
};

const ui=mountSiteAccount({
  siteId:SITE_ID,
  name:'토지한눈',
  accountTarget:'#siteAccountSlot',
  account
});
document.getElementById('siteAccountSlot')?.querySelector('.site-account-fallback')?.remove();
window.SoftmAccounts ||= new Map();
window.SoftmAccounts.set(SITE_ID,account);
window.dispatchEvent(new CustomEvent('softm:account-ready',{detail:{siteId:SITE_ID,account}}));

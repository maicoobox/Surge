/*
作者 By pysta
Surge配置参考注释，感谢@asukanana,感谢@congcong.

示例↓↓↓ 
----------------------------------------

[Proxy Group]
AmyInfo = select, policy-path=http://sub.info?url=xxx&reset_day=8&alert=1&title=AmyInfo

[Script]
Sub_info = type=http-request,pattern=http://sub\.info,script-path=https://blankmagic.github.io/surge/docs/js/sub_info.js
----------------------------------------

脚本不用修改，直接配置就好。

先将带有流量信息的订阅链接encode，用encode后的链接替换"url="后面的xxx

可选参数 &reset_day，后面的数字替换成流量每月重置的日期，如1号就写1，8号就写8。如"&reset_day=8",不加该参数不显示流量重置信息。

可选参数 &expire，机场链接不带expire信息的，可以手动传入expire参数，如"&expire=2022-02-01"

可选参数 &alert，流量用量超过80%，流量重置2天前、流量重置、套餐到期10天前，这四种情况会发送通知，参数"title=xxx" 可以自定义通知的标题。如"&alert=1&title=AmyInfo"
----------------------------------------
*/

(async () => {
  let params = getUrlParams($request.url);

  let usage = await getDataUsage(params.url);
  let used = bytesToSize(usage.download + usage.upload);
  let total = bytesToSize(usage.total);

  let expire = usage.expire || params.expire;
  let resetDay = parseInt(params["due_day"] || params["reset_day"]); 
  let resetLeft = getRmainingDays(resetDay);

  let localProxy = "=http, localhost, 6152";
  let infoList = [`流量信息：${used} | ${total}`];
  
  if (resetLeft) {
    infoList.push(`重置日期：${resetLeft} Day${resetLeft == 1 ? "" : "s"}`);
  }
  if (expire) {
    if (/^[\d]+$/.test(expire)) {
      expire = formatTimestamp(expire*1000);
    }
    infoList.push(`过期时间：${expire}`);
  }
    sendNotification(usage, resetLeft, expire, params, infoList);
    let body = infoList.map(item => item + localProxy).join("\n");
    $done({response: {body}});
})();

function getUrlParams(url) {
  return Object.fromEntries(
    url.slice(url.indexOf('?') + 1).split('&')
    .map(item => item.split("="))
    .map(([k, v]) => [k, decodeURIComponent(v)])
  );
}

function getUserInfo(url) {
  let headers = {"User-Agent": "Quantumult X"}
  let request = {headers, url}
  return new Promise(resolve => 
    $httpClient.head(request, (err, resp) => 
      resolve(resp.headers["subscription-userinfo"] || resp.headers["Subscription-userinfo"] || resp.headers["Subscription-Userinfo"])
    )
  );
}

async function getDataUsage(url) {
  let info = await getUserInfo(url);
  if (!info) {
    $notification.post("SubInfo","","链接响应头不带有流量信息")
    $done();
  }
  return Object.fromEntries(
    info.match(/\w+=\d+/g).map(item => item.split("="))
    .map(([k, v]) => [k,parseInt(v)])
  );
}

function getRmainingDays(resetDay) {
  if (!resetDay) return 0;
  let now = new Date();
  let today = now.getDate();
  let month = now.getMonth() + 1;
  let year = now.getFullYear();
  let daysInMonth = new Date(year, month, 0).getDate();
  if (resetDay > today) daysInMonth = 0;
  
  return daysInMonth - today + resetDay;
}

function bytesToSize(bytes) {
    if (bytes === 0) return '0B';
    let k = 1024;
    sizes = ['B','KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    let i = Math.floor(Math.log(bytes) / Math.log(k));
    return (bytes / Math.pow(k, i)).toFixed(2) + " " + sizes[i];
}

function formatTimestamp( timestamp ) {
    let dateObj = new Date( timestamp );
    let year = dateObj.getFullYear();
    let month = dateObj.getMonth() + 1;
    month = month < 10 ? '0' + month : month
    let day = dateObj.getDate();
    day = day < 10 ? '0' + day : day
    return year +"-"+ month +"-" + day;
}

function sendNotification(usage, resetLeft, expire, params, infoList) {
  if (!params.alert) return;
  
  let today = new Date().getDate();
  //通知计数器，每天重置
  let notifyCounter = JSON.parse($persistentStore.read("SubInfo") || '{}')
  if (!notifyCounter[today]) {
    notifyCounter = {[today]: {"used": 0,"resetLeft": 0,"expire": 0,}}
  }
  
  let count = notifyCounter[today];

  let title = params.title || "Sub Info";
  let subtitle = infoList[0];
  let body = infoList.slice(1).join("\n");
  let used = usage.download + usage.upload;
  let resetDay = params["due_day"] || params["reset_day"]; 
  
  if (used/usage.total > 0.8 && count.used < 1) {
    $notification.post(`${title} | 剩余流量不足${parseInt((1-used/usage.total)*100)}%`,subtitle, body);
    count.used += 1;
  }
  if (resetLeft && count.resetLeft < 1) {
    if (resetLeft < 2) {
      $notification.post(`${title} | 流量将在${resetLeft}天后重置`, subtitle, body);
      count.resetLeft += 1; 
    } else if (today == resetDay) {
      $notification.post(`${title} | 流量已重置`, subtitle, body);
      count.resetLeft += 1; 
    }
  }
  if (expire && count.expire < 1) {
    let diff = (new Date(expire) - new Date()) / (1000*3600*24);
    if (diff < 10) {
      $notification.post(`${title} | 套餐剩余时间不足${Math.ceil(diff)}天`, subtitle, body);
      count.expire += 1;
    } 
  }
  $persistentStore.write(JSON.stringify(notifyCounter),"SubInfo");
}
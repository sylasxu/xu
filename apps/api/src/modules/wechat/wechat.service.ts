// WeChat Service - 微信 API 封装层
// 职责：所有微信 API 调用的统一入口

/**
 * 获取微信 Access Token
 * TODO: 实现 access_token 缓存逻辑（2小时有效期）
 */
export async function getAccessToken(): Promise<string> {
  const appId = process.env.WECHAT_APP_ID;
  const appSecret = process.env.WECHAT_APP_SECRET;
  
  if (!appId || !appSecret) {
    throw new Error('微信配置缺失');
  }

  // TODO: 从缓存获取 access_token，如果过期则重新获取
  const response = await fetch(
    `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appId}&secret=${appSecret}`
  );

  const data = await response.json();
  
  if (data.errcode) {
    throw new Error(`获取 access_token 失败: ${data.errmsg}`);
  }

  return data.access_token;
}

/**
 * 发送订阅消息（服务通知）
 */
export async function sendSubscribeMessage(
  openId: string,
  templateId: string,
  page: string,
  data: Record<string, { value: string }>
): Promise<void> {
  const accessToken = await getAccessToken();
  
  const response = await fetch(
    `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${accessToken}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        touser: openId,
        template_id: templateId,
        page,
        data,
      }),
    }
  );

  const result = await response.json();
  
  if (result.errcode !== 0) {
    throw new Error(`发送订阅消息失败: ${result.errmsg}`);
  }
}

/**
 * 发送客服消息（48h 内有效）
 * 用于活动讨论区离线通知
 */
export async function sendCustomerMessage(
  openId: string,
  content: string
): Promise<boolean> {
  const accessToken = await getAccessToken();
  
  const response = await fetch(
    `https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=${accessToken}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        touser: openId,
        msgtype: 'text',
        text: { content },
      }),
    }
  );

  const data = await response.json();
  return data.errcode === 0;
}

/**
 * 生成小程序码
 * 用于海报生成
 */
export async function generateQRCode(path: string): Promise<Buffer> {
  const accessToken = await getAccessToken();
  
  const response = await fetch(
    `https://api.weixin.qq.com/wxa/getwxacode?access_token=${accessToken}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path,
        width: 280,
      }),
    }
  );

  return Buffer.from(await response.arrayBuffer());
}

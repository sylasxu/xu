import { wxLogin } from '../../src/api/user'

Page({
  data: {
    phoneNumber: '',
    isPhoneNumber: false,
    isCheck: false,
    isSubmit: false,
    isPasswordLogin: false,
    passwordInfo: {
      account: '',
      password: '',
    },
    radioValue: '',
    isLoading: false,
  },

  onLoad() {
    // 检查是否已登录
    const token = wx.getStorageSync('token')
    if (token) {
      wx.switchTab({
        url: '/pages/home/index'
      })
    }
  },

  /* 自定义功能函数 */
  changeSubmit() {
    if (this.data.isPasswordLogin) {
      if (this.data.passwordInfo.account !== '' && this.data.passwordInfo.password !== '' && this.data.isCheck) {
        this.setData({ isSubmit: true });
      } else {
        this.setData({ isSubmit: false });
      }
    } else if (this.data.isPhoneNumber && this.data.isCheck) {
      this.setData({ isSubmit: true });
    } else {
      this.setData({ isSubmit: false });
    }
  },

  // 手机号变更
  onPhoneInput(e) {
    const isPhoneNumber = /^[1][3,4,5,7,8,9][0-9]{9}$/.test(e.detail.value);
    this.setData({
      isPhoneNumber,
      phoneNumber: e.detail.value,
    });
    this.changeSubmit();
  },

  // 用户协议选择变更
  onCheckChange(e) {
    const { value } = e.detail;
    this.setData({
      radioValue: value,
      isCheck: value === 'agree',
    });
    this.changeSubmit();
  },

  onAccountChange(e) {
    this.setData({ passwordInfo: { ...this.data.passwordInfo, account: e.detail.value } });
    this.changeSubmit();
  },

  onPasswordChange(e) {
    this.setData({ passwordInfo: { ...this.data.passwordInfo, password: e.detail.value } });
    this.changeSubmit();
  },

  // 切换登录方式
  changeLogin() {
    this.setData({ isPasswordLogin: !this.data.isPasswordLogin, isSubmit: false });
  },

  // 微信登录
  async login() {
    if (!this.data.isCheck) {
      wx.showToast({
        title: '请先同意用户协议',
        icon: 'none'
      })
      return
    }

    this.setData({ isLoading: true })

    try {
      // 1. 获取微信登录凭证
      console.log('开始微信登录...')
      const loginRes = await this.wxLogin()

      if (!loginRes.code) {
        throw new Error('获取微信登录凭证失败')
      }

      console.log('获取到微信code:', loginRes.code)

      // 2. 获取用户信息（可选，用户可以拒绝）
      let userInfo = null
      try {
        userInfo = await this.getUserProfile()
        console.log('获取到用户信息:', userInfo)
      } catch (error) {
        console.log('用户拒绝授权用户信息，使用默认信息')
      }

      // 3. 调用后端登录接口
      const loginParams = {
        code: loginRes.code,
        phoneNumber: this.data.phoneNumber || null,
        nickname: userInfo?.nickName || null,
        avatarUrl: userInfo?.avatarUrl || null,
      }

      console.log('调用后端登录接口:', loginParams)
      const result = await wxLogin(loginParams)

      // 4. 保存登录信息
      wx.setStorageSync('token', result.token)
      wx.setStorageSync('userInfo', result.user)

      console.log('登录成功:', result.user)

      wx.showToast({
        title: '登录成功',
        icon: 'success'
      })

      // 5. 跳转到首页
      setTimeout(() => {
        wx.switchTab({
          url: '/pages/home/index'
        })
      }, 1500)

    } catch (error) {
      console.error('登录失败:', error)
      wx.showToast({
        title: error.message || '登录失败',
        icon: 'none'
      })
    } finally {
      this.setData({ isLoading: false })
    }
  },

  // 微信登录 - 获取code
  wxLogin() {
    return new Promise((resolve, reject) => {
      wx.login({
        success: (res) => {
          if (res.code) {
            resolve(res)
          } else {
            reject(new Error('微信登录失败'))
          }
        },
        fail: (error) => {
          console.error('wx.login失败:', error)
          reject(new Error('微信登录失败'))
        }
      })
    })
  },

  // 获取用户信息
  getUserProfile() {
    return new Promise((resolve, reject) => {
      wx.getUserProfile({
        desc: '用于完善用户资料',
        success: (res) => {
          resolve(res.userInfo)
        },
        fail: (error) => {
          console.log('getUserProfile失败:', error)
          reject(error)
        }
      })
    })
  }
});

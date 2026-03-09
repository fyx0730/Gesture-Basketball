#!/usr/bin/env node
/**
 * Basketball FRVR 游戏文本汉化脚本
 * 将 external.js 中的英文游戏文本替换为中文
 */

const fs = require('fs');
const path = require('path');

// 游戏文本翻译映射表
const translations = {
    // 游戏状态和按钮
    '"Game Over"': '"游戏结束"',
    "'Game Over'": "'游戏结束'",
    '"New Game"': '"新游戏"',
    "'New Game'": "'新游戏'",
    '"Start"': '"开始"',
    "'Start'": "'开始'",
    '"Play"': '"开始游戏"',
    "'Play'": "'开始游戏'",
    '"Restart"': '"重新开始"',
    "'Restart'": "'重新开始'",
    '"Menu"': '"菜单"',
    "'Menu'": "'菜单'",
    '"Settings"': '"设置"',
    "'Settings'": "'设置'",
    '"Close"': '"关闭"',
    "'Close'": "'关闭'",
    '"Back"': '"返回"',
    "'Back'": "'返回'",
    
    // 游戏相关
    '"Score"': '"分数"',
    "'Score'": "'分数'",
    '"High"': '"最高"',
    "'High'": "'最高'",
    '"Best"': '"最佳"',
    "'Best'": "'最佳'",
    '"Coins"': '"金币"',
    "'Coins'": "'金币'",
    '"Level"': '"关卡"',
    "'Level'": "'关卡'",
    '"Points"': '"分数"',
    "'Points'": "'分数'",
    
    // 游戏提示
    '"Try again"': '"再试一次"',
    "'Try again'": "'再试一次'",
    '"Try Again"': '"再试一次"',
    "'Try Again'": "'再试一次'",
    '"Once more"': '"再来一次"',
    "'Once more'": "'再来一次'",
    '"Again"': '"再来"',
    "'Again'": "'再来'",
    '"One more time"': '"再来一次"',
    "'One more time'": "'再来一次'",
    '"Tap to continue"': '"点击继续"',
    "'Tap to continue'": "'点击继续'",
    
    // 商店和菜单
    '"Shop"': '"商店"',
    "'Shop'": "'商店'",
    '"Ball Shop"': '"篮球商店"',
    "'Ball Shop'": "'球商店'",
    '"Select Your Ball"': '"选择您的篮球"',
    "'Select Your Ball'": "'选择您的篮球'",
    '"Change Ball"': '"更换篮球"',
    "'Change Ball'": "'更换篮球'",
    
    // 设置选项
    '"Sound Effects"': '"音效"',
    "'Sound Effects'": "'音效'",
    '"Music"': '"音乐"',
    "'Music'": "'音乐'",
    '"More"': '"更多"',
    "'More'": "'更多'",
    '"Legal"': '"法律信息"',
    "'Legal'": "'法律信息'",
    '"Credits"': '"制作人员"',
    "'Credits'": "'制作人员'",
    
    // 社交功能
    '"Share"': '"分享"',
    "'Share'": "'分享'",
    '"Login with Facebook"': '"使用 Facebook 登录"',
    "'Login with Facebook'": "'使用 Facebook 登录'",
    '"Send Feedback"': '"发送反馈"',
    "'Send Feedback'": "'发送反馈'",
    '"Write Review"': '"写评论"',
    "'Write Review'": "'写评论'",
    
    // 游戏模式
    '"Play Single"': '"单人游戏"',
    "'Play Single'": "'单人游戏'",
    '"Play Tournament"': '"锦标赛"',
    "'Play Tournament'": "'锦标赛'",
    '"Casual"': '"休闲"',
    "'Casual'": "'休闲'",
    '"Normal"': '"普通"',
    "'Normal'": "'普通'",
    '"Challenging"': '"挑战"',
    "'Challenging'": "'挑战'",
    
    // 其他
    '"Loading"': '"加载中"',
    "'Loading'": "'加载中'",
    '"Games Played"': '"游戏次数"',
    "'Games Played'": "'游戏次数'",
    '"Basketball"': '"篮球"',
    "'Basketball'": "'篮球'",
    '"Basketball Hoop Shooter"': '"篮球投篮"',
    "'Basketball Hoop Shooter'": "'篮球投篮'",
    '"No more valid moves"': '"没有有效移动"',
    "'No more valid moves'": "'没有有效移动'",
    '"Start over"': '"重新开始"',
    "'Start over'": "'重新开始'",
    '"Restart Level"': '"重新开始关卡"',
    "'Restart Level'": "'重新开始关卡'",
    '"Exit to Map"': '"退出到地图"',
    "'Exit to Map'": "'退出到地图'",
    '"Return to Calendar"': '"返回日历"',
    "'Return to Calendar'": "'返回日历'",
    '"Next coin in"': '"下一个金币"',
    "'Next coin in'": "'下一个金币'",
    '"Game over modal headline"': '"游戏结束"',
    "'Game over modal headline'": "'游戏结束'",
    '"Game over modal text"': '"游戏结束"',
    "'Game over modal text'": "'游戏结束'",
    '"Playing in tournament"': '"锦标赛中"',
    "'Playing in tournament'": "'锦标赛中'",
    '"Tournament"': '"锦标赛"',
    "'Tournament'": "'锦标赛'",
    '"Friends"': '"好友"',
    "'Friends'": "'好友'",
    '"Find players"': '"寻找玩家"',
    "'Find players'": "'寻找玩家'",
    '"Play with random group"': '"随机组队"',
    "'Play with random group'": "'随机组队'",
    '"Practice Leader board"': '"练习排行榜"',
    "'Practice Leader board'": "'练习排行榜'",
    '"Text for leaderboard"': '"排行榜"',
    "'Text for leaderboard'": "'排行榜'",
    
    // 广告相关
    '"Watch Ad"': '"观看广告"',
    "'Watch Ad'": "'观看广告'",
    '"Remove Ads"': '"移除广告"',
    "'Remove Ads'": "'移除广告'",
    '"No Ads Ready"': '"暂无广告"',
    "'No Ads Ready'": "'暂无广告'",
    '"Please try again later"': '"请稍后再试"',
    "'Please try again later'": "'请稍后再试'",
    '"No reward received"': '"未获得奖励"',
    "'No reward received'": "'未获得奖励'",
    '"Ad blocker detected"': '"检测到广告拦截器"',
    "'Ad blocker detected'": "'检测到广告拦截器'",
    '"Undo throw and keep playing"': '"撤销投掷并继续游戏"',
    "'Undo throw and keep playing'": "'撤销投掷并继续游戏'",
    '"No thanks"': '"不了，谢谢"',
    "'No thanks'": "'不了，谢谢'",
    '"Install Now"': '"立即安装"',
    "'Install Now'": "'立即安装'",
    
    // 确认对话框
    '"Confirm"': '"确认"',
    "'Confirm'": "'确认'",
    '"Cancel"': '"取消"',
    "'Cancel'": "'取消'",
};

// 文件路径
const filePath = path.join(__dirname, 'v/1576154515838/external.js');
const backupPath = path.join(__dirname, 'v/1576154515838/external.js.backup');

console.log('开始汉化游戏文本...\n');

// 检查文件是否存在
if (!fs.existsSync(filePath)) {
    console.error('错误: 找不到 external.js 文件');
    process.exit(1);
}

// 读取文件
let content = fs.readFileSync(filePath, 'utf8');
const originalLength = content.length;

console.log(`原始文件大小: ${originalLength} 字符\n`);

// 执行替换
let replaceCount = 0;
for (const [en, zh] of Object.entries(translations)) {
    const regex = new RegExp(en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    const matches = content.match(regex);
    if (matches) {
        content = content.replace(regex, zh);
        replaceCount += matches.length;
        console.log(`✓ 替换: ${en} -> ${zh} (${matches.length} 次)`);
    }
}

const newLength = content.length;
const diff = newLength - originalLength;

console.log(`\n替换完成!`);
console.log(`- 共替换 ${replaceCount} 处文本`);
console.log(`- 文件大小变化: ${diff > 0 ? '+' : ''}${diff} 字符`);

// 保存文件
fs.writeFileSync(filePath, content, 'utf8');
console.log(`\n✓ 文件已保存: ${filePath}`);
console.log(`✓ 备份文件: ${backupPath}`);


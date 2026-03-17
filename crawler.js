const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

// 配置请求头，模拟真实浏览器
const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Referer': 'https://www.google.com/',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'cross-site',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1'
};

async function crawlSchedule() {
  console.log('正在请求网页...');
  
  try {
    // 发送 HTTP GET 请求
    const response = await axios.get('https://plavecalendar.com/', { 
      headers,
      timeout: 30000 // 30秒超时
    });
    
    console.log('网页获取成功，状态码:', response.status);
    
    // 加载 HTML 到 cheerio
    const $ = cheerio.load(response.data);
    
    // 提取月份和年份
    const monthYear = $('button span.text-lg.font-bold').first().text().trim() || 
                      $('.text-lg.sm\\:text-xl.font-bold').first().text().trim();
    console.log('当前显示:', monthYear);
    
    const [year, month] = monthYear.split(' ');
    const monthMap = {
      'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
      'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
      'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
    };
    const monthNum = monthMap[month] || '01';
    const baseDateStr = `${year}-${monthNum}`;
    
    console.log('基准日期:', baseDateStr);
    
    // 提取所有日程
    const events = [];
    
    // 选择所有日期格子
    $('.grid.grid-cols-7 > div').each((index, element) => {
      const cell = $(element);
      
      // 获取日期数字
      const dayEl = cell.find('.flex .flex .text-gray-900, .flex .flex .text-gray-400, .flex .flex .font-bold').first();
      if (dayEl.length === 0) return;
      
      const dayText = dayEl.text().trim();
      const day = dayText.padStart(2, '0');
      
      // 跳过非本月的日期（灰色日期）
      if (dayEl.hasClass('text-gray-400')) return;
      
      const fullDate = `${baseDateStr}-${day}`;
      
      // 获取该日的所有事件按钮
      const buttons = cell.find('ul li button');
      buttons.each((btnIndex, btn) => {
        const btnEl = $(btn);
        const titleAttr = btnEl.attr('title') || '';
        
        let time = '待定';
        let title = titleAttr;
        
        // 解析时间（上午/下午格式）
        const timeMatch = titleAttr.match(/(上午|下午)(\d{1,2}):(\d{2})/);
        if (timeMatch) {
          const [_, ampm, hour, minute] = timeMatch;
          let hourKST = parseInt(hour);
          if (ampm === '下午' && hourKST !== 12) hourKST += 12;
          if (ampm === '上午' && hourKST === 12) hourKST = 0;
          // 转换为中国时间 (KST - 1)
          let hourCST = hourKST - 1;
          if (hourCST < 0) hourCST += 24;
          time = `${hourCST.toString().padStart(2, '0')}:${minute} CST`;
          title = titleAttr.replace(timeMatch[0], '').trim();
        }
        
        // 提取成员表情
        const memberMatch = title.match(/[💙💜🩷❤️🖤]+/);
        const member = memberMatch ? memberMatch[0] : '';
        
        events.push({
          title,
          date: fullDate,
          time,
          member
        });
      });
    });
    
    console.log(`提取到原始日程 ${events.length} 条`);
    
    // 过滤：保留包含🩷 或 不含任何成员表情的事件
    const memberEmojis = ['💙', '💜', '🩷', '❤️', '🖤'];
    const filtered = events.filter(ev => 
      ev.title.includes('🩷') || !memberEmojis.some(emoji => ev.title.includes(emoji))
    );
    
    console.log(`过滤后保留 ${filtered.length} 条（斑比相关+团体活动）`);
    
    // 添加类型和平台字段
    filtered.forEach(ev => {
      // 类型判断
      if (ev.title.includes('LIVE')) ev.type = 'live';
      else if (ev.title.includes('SBS')) ev.type = 'media';
      else ev.type = 'other';
      
      // 平台判断
      if (ev.title.includes('WEVERSE')) {
        ev.platform = 'Weverse';
      } else if (ev.title.includes('SBS')) {
        ev.platform = 'SBS';
      } else if (ev.title.includes('LIVE')) {
        ev.platform = 'YouTube/B站';
      } else {
        ev.platform = '未知';
      }
      
      // 添加网站需要的其他字段
      ev.preview = {};
      ev.replay = {};
      ev.important = false;
    });
    
    // 按日期分类
    const today = new Date().toISOString().split('T')[0];
    const upcoming = filtered.filter(ev => ev.date >= today).sort((a, b) => a.date.localeCompare(b.date));
    const past = filtered.filter(ev => ev.date < today).sort((a, b) => b.date.localeCompare(a.date));
    
    // 保存为 JSON
    const output = { upcoming, past };
    fs.writeFileSync('schedule.json', JSON.stringify(output, null, 2));
    console.log(`已保存 ${filtered.length} 条日程到 schedule.json`);
    
  } catch (error) {
    console.error('爬取过程中发生错误:');
    if (error.response) {
      // 服务器返回了错误状态码
      console.error('状态码:', error.response.status);
      console.error('响应头:', error.response.headers);
      console.error('响应内容预览:', error.response.data.substring(0, 500));
    } else if (error.request) {
      // 请求已发送但无响应
      console.error('无响应:', error.request);
    } else {
      // 请求配置出错
      console.error('请求错误:', error.message);
    }
    throw error;
  }
}

// 执行主函数
crawlSchedule().catch(err => {
  console.error('爬虫运行失败');
  process.exit(1);
});

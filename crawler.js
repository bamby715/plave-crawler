const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  console.log('启动浏览器...');
  
  // 启动浏览器，添加必要的参数以适应 GitHub Actions 环境
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu'
    ]
  });
  
  const page = await browser.newPage();
  
  // 设置更真实的 User-Agent
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  const url = 'https://plavecalendar.com/';
  console.log(`正在访问 ${url} ...`);

  // 导航到目标页面，增加重试机制
  const maxRetries = 3;
  let loaded = false;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      await page.goto(url, { 
        waitUntil: 'networkidle2', 
        timeout: 60000 
      });
      loaded = true;
      console.log(`第 ${i + 1} 次尝试成功`);
      break;
    } catch (err) {
      console.log(`第 ${i + 1} 次加载失败${i < maxRetries - 1 ? '，5秒后重试...' : ''}`);
      if (i < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }
  
  if (!loaded) {
    throw new Error('页面加载失败，已达到最大重试次数');
  }

  // 等待日历容器出现，超时 30 秒
  console.log('等待日历元素加载...');
  try {
    await page.waitForSelector('.grid.grid-cols-7', { timeout: 30000 });
    console.log('日历元素已找到');
  } catch (err) {
    // 如果超时，打印页面标题和部分内容帮助诊断
    const title = await page.title();
    const bodyPreview = await page.evaluate(() => document.body.innerText.slice(0, 500));
    console.error(`页面标题: ${title}`);
    console.error(`页面内容预览: ${bodyPreview}`);
    throw new Error('未找到日历元素，页面结构可能已变化');
  }

  // 获取月份和年份
  console.log('正在提取月份信息...');
  let monthYear, year, month;
  try {
    monthYear = await page.$eval('button span.text-lg.font-bold', el => el.textContent.trim());
    console.log('当前显示:', monthYear);
    [year, month] = monthYear.split(' ');
  } catch (err) {
    // 尝试备选选择器
    monthYear = await page.$eval('.text-lg.sm\\:text-xl.font-bold', el => el.textContent.trim());
    console.log('当前显示 (备选选择器):', monthYear);
    [year, month] = monthYear.split(' ');
  }

  const monthMap = {
    'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
    'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
    'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
  };
  const monthNum = monthMap[month] || '01';
  const baseDateStr = `${year}-${monthNum}`;

  // 提取所有日程
  console.log('正在提取日程数据...');
  const events = await page.evaluate((baseDateStr) => {
    const result = [];
    document.querySelectorAll('.grid.grid-cols-7 > div').forEach(cell => {
      const dayEl = cell.querySelector('.flex .flex .text-gray-900, .flex .flex .text-gray-400, .flex .flex .font-bold');
      if (!dayEl) return;
      const day = dayEl.textContent.trim().padStart(2, '0');
      if (dayEl.classList.contains('text-gray-400')) return; // 非本月跳过
      const fullDate = `${baseDateStr}-${day}`;

      cell.querySelectorAll('ul li button').forEach(btn => {
        const titleAttr = btn.getAttribute('title') || '';
        let timeStr = '';
        let time = '';
        let title = titleAttr;

        // 匹配中文时间格式
        const timeMatch = titleAttr.match(/(上午|下午)(\d{1,2}):(\d{2})/);
        if (timeMatch) {
          const [_, ampm, hour, minute] = timeMatch;
          timeStr = timeMatch[0];
          // 转换为24小时制（假设为韩国时间KST）
          let hourKST = parseInt(hour);
          if (ampm === '下午' && hourKST !== 12) hourKST += 12;
          if (ampm === '上午' && hourKST === 12) hourKST = 0;
          // 转换为中国时间CST（KST - 1）
          let hourCST = hourKST - 1;
          if (hourCST < 0) hourCST += 24; // 跨天处理
          time = `${hourCST.toString().padStart(2, '0')}:${minute} CST`;
          title = titleAttr.replace(timeMatch[0], '').trim();
        } else {
          time = '待定';
        }

        // 提取成员emoji
        const memberMatch = title.match(/[💙💜🩷❤️🖤]+/);
        const member = memberMatch ? memberMatch[0] : '';

        result.push({ title, date: fullDate, time, member, rawTime: timeStr });
      });
    });
    return result;
  }, baseDateStr);

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

    // 添加其他字段
    ev.preview = {};
    ev.replay = {};
    ev.important = false;
  });

  // 按日期分类
  const today = new Date().toISOString().split('T')[0];
  const upcoming = filtered.filter(ev => ev.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const past = filtered.filter(ev => ev.date < today).sort((a, b) => b.date.localeCompare(a.date));

  // 保存为 JSON
  fs.writeFileSync('schedule.json', JSON.stringify({ upcoming, past }, null, 2));
  console.log(`已保存 ${filtered.length} 条日程到 schedule.json`);

  await browser.close();
  console.log('浏览器已关闭');
})();

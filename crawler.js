const puppeteer = require('puppeteer-extra'); // 使用 puppeteer-extra 插件
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

// 使用 stealth 插件来隐藏自动化特征
puppeteer.use(StealthPlugin());

(async () => {
  console.log('启动浏览器（隐身模式）...');

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--window-size=1920,1080',
      '--disable-blink-features=AutomationControlled' // 重要：移除自动化控制特征
    ]
  });

  const page = await browser.newPage();

  // 设置更真实的 User-Agent 和额外头部
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Referer': 'https://www.google.com/'
  });

  // 隐藏 webdriver 属性
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const url = 'https://plavecalendar.com/';
  console.log(`正在访问 ${url} ...`);

  // 增加随机延迟，模仿人类行为
  await new Promise(r => setTimeout(r, Math.random() * 2000 + 1000));

  // 导航到目标页面，增加重试
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

  // 检查页面标题，确认是否被拒绝
  const pageTitle = await page.title();
  console.log(`页面标题: ${pageTitle}`);
  if (pageTitle.includes('403') || pageTitle.includes('Forbidden')) {
    throw new Error('访问被拒绝 (403)，可能触发了反爬机制');
  }

  // 等待日历容器出现，超时 30 秒
  console.log('等待日历元素加载...');
  try {
    await page.waitForSelector('.grid.grid-cols-7', { timeout: 30000 });
    console.log('日历元素已找到');
  } catch (err) {
    const bodyPreview = await page.evaluate(() => document.body.innerText.slice(0, 500));
    console.error(`页面内容预览: ${bodyPreview}`);
    throw new Error('未找到日历元素，页面结构可能已变化');
  }

  // 从您提供的 HTML 中提取数据（直接使用页面评估，避免依赖选择器失效）
  console.log('正在提取日程数据...');
  const events = await page.evaluate((baseDateStr) => {
    const result = [];
    // 根据您提供的 HTML 结构调整选择器
    document.querySelectorAll('.grid.grid-cols-7 > div').forEach(cell => {
      // 获取日期数字
      const dayEl = cell.querySelector('.flex .flex .text-gray-900, .flex .flex .text-gray-400, .flex .flex .font-bold');
      if (!dayEl) return;
      const day = dayEl.textContent.trim().padStart(2, '0');
      if (dayEl.classList.contains('text-gray-400')) return; // 非本月跳过
      const fullDate = `${baseDateStr}-${day}`;

      // 获取该日的所有事件
      const buttons = cell.querySelectorAll('ul li button');
      buttons.forEach(btn => {
        const titleAttr = btn.getAttribute('title') || '';
        // 从 title 属性解析，例如 "PLAVE LIVE 💙❤️ 下午8:00"
        let time = '待定';
        let title = titleAttr;

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

        // 提取成员 emoji
        const memberMatch = title.match(/[💙💜🩷❤️🖤]+/);
        const member = memberMatch ? memberMatch[0] : '';

        result.push({ title, date: fullDate, time, member });
      });
    });
    return result;
  }, baseDateStr); // baseDateStr 稍后计算

  // 获取月份和年份（使用更可靠的方式）
  const monthYear = await page.$eval('button span.text-lg.font-bold', el => el.textContent.trim())
    .catch(() => page.$eval('.text-lg.sm\\:text-xl.font-bold', el => el.textContent.trim()));
  console.log('当前显示:', monthYear);
  const [year, month] = monthYear.split(' ');
  const monthMap = {
    'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
    'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
    'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
  };
  const monthNum = monthMap[month] || '01';
  const baseDateStr = `${year}-${monthNum}`;

  // 由于上面 evaluate 中的 baseDateStr 是 undefined，我们需要重新运行一次提取
  // 更简单的方法是重新执行 evaluate，传入正确的 baseDateStr
  const finalEvents = await page.evaluate((baseDateStr) => {
    const result = [];
    document.querySelectorAll('.grid.grid-cols-7 > div').forEach(cell => {
      const dayEl = cell.querySelector('.flex .flex .text-gray-900, .flex .flex .text-gray-400, .flex .flex .font-bold');
      if (!dayEl) return;
      const day = dayEl.textContent.trim().padStart(2, '0');
      if (dayEl.classList.contains('text-gray-400')) return;
      const fullDate = `${baseDateStr}-${day}`;

      cell.querySelectorAll('ul li button').forEach(btn => {
        const titleAttr = btn.getAttribute('title') || '';
        let time = '待定', title = titleAttr;
        const timeMatch = titleAttr.match(/(上午|下午)(\d{1,2}):(\d{2})/);
        if (timeMatch) {
          const [_, ampm, hour, minute] = timeMatch;
          let hourKST = parseInt(hour);
          if (ampm === '下午' && hourKST !== 12) hourKST += 12;
          if (ampm === '上午' && hourKST === 12) hourKST = 0;
          let hourCST = hourKST - 1;
          if (hourCST < 0) hourCST += 24;
          time = `${hourCST.toString().padStart(2, '0')}:${minute} CST`;
          title = titleAttr.replace(timeMatch[0], '').trim();
        }
        const memberMatch = title.match(/[💙💜🩷❤️🖤]+/);
        const member = memberMatch ? memberMatch[0] : '';
        result.push({ title, date: fullDate, time, member });
      });
    });
    return result;
  }, baseDateStr);

  console.log(`提取到原始日程 ${finalEvents.length} 条`);

  // 过滤：保留包含🩷 或 不含任何成员表情的事件
  const memberEmojis = ['💙', '💜', '🩷', '❤️', '🖤'];
  const filtered = finalEvents.filter(ev =>
    ev.title.includes('🩷') || !memberEmojis.some(emoji => ev.title.includes(emoji))
  );

  console.log(`过滤后保留 ${filtered.length} 条（斑比相关+团体活动）`);

  // 添加类型和平台字段
  filtered.forEach(ev => {
    if (ev.title.includes('LIVE')) ev.type = 'live';
    else if (ev.title.includes('SBS')) ev.type = 'media';
    else ev.type = 'other';

    if (ev.title.includes('WEVERSE')) {
      ev.platform = 'Weverse';
    } else if (ev.title.includes('SBS')) {
      ev.platform = 'SBS';
    } else if (ev.title.includes('LIVE')) {
      ev.platform = 'YouTube/B站';
    } else {
      ev.platform = '未知';
    }
    ev.preview = {};
    ev.replay = {};
    ev.important = false;
  });

  // 按日期分类
  const today = new Date().toISOString().split('T')[0];
  const upcoming = filtered.filter(ev => ev.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const past = filtered.filter(ev => ev.date < today).sort((a, b) => b.date.localeCompare(a.date));

  fs.writeFileSync('schedule.json', JSON.stringify({ upcoming, past }, null, 2));
  console.log(`已保存 ${filtered.length} 条日程到 schedule.json`);

  await browser.close();
  console.log('浏览器已关闭');
})();

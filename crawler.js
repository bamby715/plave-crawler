const { firefox } = require('playwright'); // 使用 firefox 尝试
const fs = require('fs');

(async () => {
  console.log('启动 Firefox 浏览器...');
  // 启动 firefox
  const browser = await firefox.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0'
  });
  const page = await context.newPage();

  // 设置额外的 HTTP 头
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Referer': 'https://www.google.com/'
  });

  const url = 'https://plavecalendar.com/';
  console.log(`正在访问 ${url} ...`);

  // 重试机制
  const maxRetries = 3;
  for (let i = 0; i < maxRetries; i++) {
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
      console.log(`第 ${i + 1} 次尝试成功`);
      break;
    } catch (err) {
      if (i === maxRetries - 1) throw err;
      console.log(`第 ${i + 1} 次加载失败，5秒后重试...`);
      await page.waitForTimeout(5000);
    }
  }

  // 检查是否被拒绝
  const pageTitle = await page.title();
  console.log('页面标题:', pageTitle);
  if (pageTitle.includes('403') || pageTitle.includes('Forbidden')) {
    throw new Error('访问被拒绝 (403)');
  }

  // 等待日历元素
  console.log('等待日历元素...');
  await page.waitForSelector('.grid.grid-cols-7', { timeout: 30000 });

  // 获取月份
  const monthYear = await page.$eval('button span.text-lg.font-bold', el => el.textContent.trim())
    .catch(() => page.$eval('.text-lg.sm\\:text-xl.font-bold', el => el.textContent.trim()));
  console.log('当前显示:', monthYear);
  const [year, month] = monthYear.split(' ');
  const monthMap = { Jan:'01', Feb:'02', Mar:'03', Apr:'04', May:'05', Jun:'06',
    Jul:'07', Aug:'08', Sep:'09', Oct:'10', Nov:'11', Dec:'12' };
  const baseDateStr = `${year}-${monthMap[month] || '01'}`;

  // 提取日程
  const events = await page.evaluate((baseDateStr) => {
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

  console.log(`提取到原始日程 ${events.length} 条`);

  // 过滤、分类、保存（与之前相同）
  const memberEmojis = ['💙', '💜', '🩷', '❤️', '🖤'];
  const filtered = events.filter(ev => ev.title.includes('🩷') || !memberEmojis.some(e => ev.title.includes(e)));

  filtered.forEach(ev => {
    ev.type = ev.title.includes('LIVE') ? 'live' : (ev.title.includes('SBS') ? 'media' : 'other');
    ev.platform = ev.title.includes('WEVERSE') ? 'Weverse' : (ev.title.includes('SBS') ? 'SBS' : (ev.title.includes('LIVE') ? 'YouTube/B站' : '未知'));
    ev.preview = {};
    ev.replay = {};
    ev.important = false;
  });

  const today = new Date().toISOString().split('T')[0];
  const upcoming = filtered.filter(ev => ev.date >= today).sort((a,b) => a.date.localeCompare(b.date));
  const past = filtered.filter(ev => ev.date < today).sort((a,b) => b.date.localeCompare(a.date));

  fs.writeFileSync('schedule.json', JSON.stringify({ upcoming, past }, null, 2));
  console.log(`已保存 ${filtered.length} 条日程`);

  await browser.close();
})();

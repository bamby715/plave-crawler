const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  console.log('启动浏览器...');
  const browser = await puppeteer.launch({ 
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  await page.goto('https://plavecalendar.com/', { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('.grid.grid-cols-7', { timeout: 10000 });

  // 获取月份和年份
  const monthYear = await page.$eval('button span.text-lg.font-bold', el => el.textContent.trim());
  const [year, month] = monthYear.split(' ');
  const monthMap = { Jan:'01', Feb:'02', Mar:'03', Apr:'04', May:'05', Jun:'06', Jul:'07', Aug:'08', Sep:'09', Oct:'10', Nov:'11', Dec:'12' };
  const baseDateStr = `${year}-${monthMap[month]}`;

  // 提取所有日程
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
        let timeStr = ''; // 原始时间文本（含上午/下午）
        let time = '';    // 转换后的时间
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
          // 处理跨天（理论上都在同一天，但若KST为0点则CST为前一天的23点，但日程通常不会在0点，为保险处理）
          if (hourCST < 0) hourCST += 24; // 如果出现跨天，日期仍保留原日（按原日显示前一日23点）
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
  const upcoming = filtered.filter(ev => ev.date >= today).sort((a,b) => a.date.localeCompare(b.date));
  const past = filtered.filter(ev => ev.date < today).sort((a,b) => b.date.localeCompare(a.date));

  // 保存为 JSON
  fs.writeFileSync('schedule.json', JSON.stringify({ upcoming, past }, null, 2));
  console.log(`已保存 ${filtered.length} 条日程`);
  await browser.close();
})();

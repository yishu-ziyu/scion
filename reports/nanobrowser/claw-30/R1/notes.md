# R1 列表抽取 → CSV 表

- **Claw 故事:** Amazon 列表 → 价格/评分表
- **持节状态:** **partial**（本地 fixture e2e 绿；≠ Amazon 真机 pass）
- **验收句（fixture）:** `Extract products to a CSV table with name, price, rating`
  - 打开本地 `/products`（≥5 商品）
  - task `completed`，成果含表头 `name,price,rating`
  - 数据行 ≥5（实测 6 行）
- **证据（2026-07-24）:**
  - `pnpm -F chrome-extension e2e:r1-extract` → PASS
  - `reports/nanobrowser/claw-30/R1/e2e-r1-extract.log`
  - 单测 product-table / extract-products / journey 通过
- **实现:** 确定性 HTML 解析 → CSV 写进完成摘要/成果槽（不靠「页上已有文字」当完成条件）
- **还差:** Amazon 真机；下载文件按钮；分页长列表

# Korean public holidays

The calendar keeps a bundled 2018–2027 public-holiday fallback from
[hyunbinseo/holidays-kr](https://github.com/hyunbinseo/holidays-kr/tree/6479b938f3c1249be7d845926b300ffc33ffcb69/public)
(commit `6479b938f3c1249be7d845926b300ffc33ffcb69`, retrieved 2026-10-04). Its data is based on the official annual calendar notices.
Lunar holidays, substitute holidays, election days and designated temporary holidays are included.
The UI renders these as date annotations; no personal events, reminders or vault files are created.

The snapshot includes the 2026 additions of Labour Day and Constitution Day,
confirmed by the [Ministry of Personnel Management](https://www.mpm.go.kr/mpm/comm/newsPress/newsPressRelease/?boardId=bbs_0000000000000029&cntId=4250&mode=view&pageIdx=1).
The 2027 calendar is covered by the [Korea AeroSpace Administration notice](https://www.kasa.go.kr/prog/plcyBrf/brief/kor/sub01_01_04/view.do?plcyBrfNo=431).

## Automatic updates

When the calendar opens or the window regains focus, it loads the saved data and
requests the [all-years JSON feed](https://holidays.hyunbin.page/basic.json) in the
background if the last successful check was at least 24 hours ago. The feed is
grouped by year; the client validates and flattens those groups before displaying them.
New years and temporary holidays appear once the upstream feed includes them.
The request goes directly to the public host, which permits browser CORS requests.

The data and check time are cached in `localStorage` under `orbit:korean-holidays:v1`.
Concurrent refreshes within a page share one request. Failures retain the last usable
data and do not retry again within the same page for 24 hours. A reload can retry a
failed request. Requests time out after 10 seconds. If browser storage is unavailable,
the current page keeps its data in memory. No API key, server job or interval timer is needed.

## Updating the bundled fallback

When a new annual notice or temporary holiday is announced, verify the upstream
`public/YYYY.json` against the official notice, merge its full date-to-names mapping
into `src/lib/orbit/korean-holidays.data.ts`, and update the source commit and retrieval date here and in that file.
Keep multiple names on overlapping dates. Run the holiday tests and typecheck.
Dates outside the downloaded or bundled years have no holiday annotations; do not
infer lunar dates or future temporary holidays. The fallback remains available offline
even on a first visit without a saved cache.

## Upstream license

MIT License

Copyright (c) 2023 Hyunbin Seo

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

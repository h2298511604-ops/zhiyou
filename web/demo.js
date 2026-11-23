/* ============================================================
   内置示例数据
   ------------------------------------------------------------
   一个真实的、可共鸣的案例：电子信息工程 → 3 年经验 → 四个方向。
   这份数据用于「零配置预览」：没配 API Key 也能看到产品形态。
   ============================================================ */

const DEMO = {

  /* ---------------- 事实原子库 ---------------- */

  factBase: {
    meta: {
      headline: '3 年嵌入式开发，做过从固件到量产的完整链路',
      years: 3,
      domains: ['智能家居', '物联网']
    },
    experiences: [
      {
        id: 'exp1',
        org: '某智能家居科技有限公司',
        role: '嵌入式软件工程师',
        period: '2023.07 - 至今',
        bullets: [
          {
            id: 'b1',
            text: '基于 STM32F4 + FreeRTOS 开发智能家居网关固件，实现多任务调度与低功耗休眠',
            metrics: ['待机电流 8mA → 1.2mA'],
            skills: ['STM32', 'FreeRTOS', 'C'],
            tags: ['embedded'],
            evidence: 'strong'
          },
          {
            id: 'b2',
            text: '移植并裁剪 lwIP 协议栈，完成 MQTT / CoAP 双协议接入',
            metrics: ['固件体积控制在 256KB Flash 以内'],
            skills: ['lwIP', 'MQTT', 'CoAP'],
            tags: ['embedded'],
            evidence: 'strong'
          },
          {
            id: 'b3',
            text: '独立实现 OTA 固件升级链路，含差分包与断点续传',
            metrics: ['现场升级成功率 99.2%'],
            skills: ['OTA', '差分包'],
            tags: ['embedded'],
            evidence: 'strong'
          },
          {
            id: 'b4',
            text: '定位并解决 Zigbee 百节点组网丢包问题',
            metrics: ['丢包率 12% → 0.8%'],
            skills: ['Zigbee', '射频调试'],
            tags: ['embedded'],
            evidence: 'strong'
          },
          {
            id: 'b5',
            text: '参与网关主控选型，对比 4 颗候选芯片的功耗 / 成本 / 供货周期，输出选型报告',
            metrics: [],
            skills: ['硬件选型', 'BOM 成本'],
            tags: ['hardware', 'pm'],
            evidence: 'medium'
          },
          {
            id: 'b6',
            text: '配合硬件工程师完成 4 层 PCB 的 EMC 整改，产品通过 CE 预测试',
            metrics: [],
            skills: ['EMC', 'PCB'],
            tags: ['hardware'],
            evidence: 'medium'
          },
          {
            id: 'b7',
            text: '编写产线烧录与测试工装脚本，压缩单台测试耗时',
            metrics: ['单台测试 6min → 90s'],
            skills: ['Python', '产线工装'],
            tags: ['embedded', 'hardware'],
            evidence: 'strong'
          },
          {
            id: 'b8',
            text: '支持 20+ 客户完成设备接入与现场调试，输出 3 类典型场景的部署文档',
            metrics: ['20+ 客户'],
            skills: ['客户支持', '技术文档'],
            tags: ['presales'],
            evidence: 'medium'
          },
          {
            id: 'b9',
            text: '参与客户批量异常的技术复盘，定位为现场路由器 DHCP 租期配置问题',
            metrics: ['避免约 30 万元潜在退货'],
            skills: ['故障定位', '复盘'],
            tags: ['presales', 'pm'],
            evidence: 'medium'
          }
        ]
      },
      {
        id: 'exp2',
        org: '某高校智能感知实验室',
        role: '研究助理（实习）',
        period: '2022.03 - 2023.06',
        bullets: [
          {
            id: 'b10',
            text: '参与无线传感网络节点项目，负责节点固件与数据采集链路',
            metrics: [],
            skills: ['C', '无线传感'],
            tags: ['embedded'],
            evidence: 'medium'
          },
          {
            id: 'b11',
            text: '用 Python 搭建自动化测试脚本',
            metrics: ['覆盖 40+ 测试用例'],
            skills: ['Python', '自动化测试'],
            tags: ['embedded'],
            evidence: 'strong'
          }
        ]
      }
    ],
    skills: ['C', 'C++', 'FreeRTOS', 'STM32', 'Zigbee', 'lwIP', 'MQTT', 'Python', 'Altium Designer'],
    education: [
      { school: '某大学', major: '电子信息工程', degree: '本科', year: '2022' }
    ],
    personas: [
      {
        id: 'embedded',
        name: '嵌入式软件工程师',
        strength: 5,
        thesis: '你的核心资产是：从固件到量产、从协议栈到现场问题的完整闭环。能独立把产品从 0 做到上线的人，比会写代码的人少得多。',
        focus: ['底层协议栈与实时系统', '现场问题定位能力', '量产落地经验'],
        jobs: ['嵌入式软件工程师', '固件开发工程师', 'IoT 软件工程师', '驱动开发工程师'],
        bulletIds: ['b1', 'b2', 'b3', 'b4', 'b7', 'b11']
      },
      {
        id: 'hardware',
        name: '硬件开发工程师',
        strength: 4,
        thesis: '你不是纯画板子的硬件工程师——你能同时看懂固件和硬件。联调的时候，你比谁都省事，这是很多硬件岗真正缺的人。',
        focus: ['主控选型与成本控制', 'EMC 与量产导入', '软硬联调能力'],
        jobs: ['硬件工程师', 'PCB 设计工程师', '硬件系统工程师'],
        bulletIds: ['b5', 'b6', 'b7', 'b1']
      },
      {
        id: 'presales',
        name: '售前 / 技术支持',
        strength: 3,
        thesis: '技术出身 + 直接面对过 20+ 客户。你能听懂客户说什么，也能翻译成研发听得懂的话——这个位置最难找的就是这种人。',
        focus: ['客户现场问题闭环', '方案与技术文档输出', '技术与业务之间的翻译'],
        jobs: ['技术支持工程师', 'FAE', '售前工程师', '解决方案工程师'],
        bulletIds: ['b8', 'b9', 'b5', 'b4']
      },
      {
        id: 'pm',
        name: '产品经理（IoT 方向）',
        strength: 2,
        thesis: '你现在是纯技术视角，缺的是用户视角。想转，得先补一个作品——一份真实的产品需求文档，比说十句"我有产品思维"有用。',
        focus: ['技术可行性判断', '成本与工期评估', '跨团队协作'],
        jobs: ['IoT 产品经理', '硬件产品经理（需补作品）'],
        bulletIds: ['b5', 'b9', 'b8']
      }
    ]
  },

  /* ---------------- 示例 JD ---------------- */

  sampleJd: `【嵌入式软件工程师】25-40K · 3-5年 · 本科

岗位职责：
1. 负责公司 IoT 网关产品的嵌入式软件设计与开发；
2. 基于 RTOS 完成多任务应用开发，负责通信协议栈的集成与优化；
3. 参与产品的低功耗设计与性能优化；
4. 配合硬件团队完成软硬件联调与量产导入；
5. 参与现场问题定位与技术支持。

任职要求：
1. 本科及以上学历，电子、通信、计算机相关专业，3 年以上嵌入式开发经验；
2. 精通 C 语言，熟悉 FreeRTOS / RT-Thread 等至少一种 RTOS；
3. 熟悉 TCP/IP 协议栈，有 MQTT、CoAP 等物联网协议实际开发经验；
4. 熟悉 STM32 或同类 MCU，有低功耗设计经验者优先；
5. 有 Linux 平台开发经验者优先；
6. 有 Zigbee / BLE 等无线通信调试经验者优先；
7. 具备良好的沟通能力和团队协作精神，能承受一定的工作压力。`,

  /* ---------------- 示例简历（故意写得很「瘦」，用来演示挖料价值） ---------------- */

  sampleResume: `李维 | 男 | 1999 | 电话 138****0000 | 邮箱 liwei@example.com
求职意向：嵌入式软件工程师 / 硬件工程师

【教育背景】
2018.09 - 2022.06  某大学  电子信息工程  本科
主修课程：模拟电子技术、数字电路、单片机原理、信号与系统、通信原理

【工作经历】
2023.07 - 至今   某智能家居科技有限公司   嵌入式软件工程师
- 负责智能家居网关的固件开发
- 参与低功耗方案设计
- 配合硬件同事做联调
- 处理客户反馈的问题

2022.03 - 2023.06   某高校智能感知实验室   研究助理
- 参与无线传感网络项目
- 负责节点固件开发
- 写了一些测试脚本

【项目经历】
毕业设计：基于 STM32 的智能家居网关
- 完成硬件设计和软件开发
- 实现了手机 APP 远程控制

【技能】
- 熟悉 C 语言，了解 C++
- 熟悉 STM32，用过 FreeRTOS
- 会用 Altium Designer 画板子
- 英语 CET-6`,

  /* ---------------- 预生成的投影结果 ---------------- */

  sampleProjection: {
    jdAnalysis: {
      title: '嵌入式软件工程师',
      company: '某物联网公司',
      salary: '25-40K',
      direction: 'embedded',
      summary: '在找一个能独立扛 IoT 网关固件的人：RTOS + 协议栈 + 低功耗三件套齐全，还要能下现场。'
    },
    verdict: {
      score: 84,
      level: 'go',
      summary: '硬门槛 4 条全中，两个加分项也拿到了。唯一要想清楚的是「量产导入」你实际做到哪一步——JD 第 4 条点了这个，面试一定会问。'
    },
    hits: [
      { req: '3 年以上嵌入式开发经验', evidence: '2022 年起实验室项目 + 2023.07 至今，累计 3 年半', bulletId: 'b1' },
      { req: '精通 C / 熟悉 FreeRTOS', evidence: '网关固件基于 FreeRTOS 搭多任务框架，C 是主力语言', bulletId: 'b1' },
      { req: 'TCP/IP 协议栈 + MQTT/CoAP 实际开发', evidence: '移植裁剪 lwIP，MQTT / CoAP 双协议接入', bulletId: 'b2' },
      { req: 'STM32 + 低功耗设计', evidence: 'STM32F4 平台，待机电流 8mA → 1.2mA', bulletId: 'b1' },
      { req: 'Zigbee / BLE 无线调试（优先）', evidence: 'Zigbee 百节点丢包定位，12% → 0.8%', bulletId: 'b4' }
    ],
    gaps: [
      { req: 'Linux 平台开发经验（优先）', note: '事实库里没有任何 Linux 相关经历。这是加分项不是门槛，不影响投；但面试大概率会问，提前想好怎么答。' },
      { req: '量产导入 / NPI', note: '你有产线工装的实际经验（b7），但没写过 NPI 报告。这算「有事实没表达」，面试时把 b7 展开讲就行，不用假装。' }
    ],
    highlights: [
      {
        rank: 1,
        title: '网关固件全链路：低功耗 + 协议栈',
        text: '基于 STM32F4 + FreeRTOS 独立完成 IoT 网关固件开发，多任务框架下把待机电流从 8mA 压到 1.2mA；移植裁剪 lwIP 并完成 MQTT / CoAP 双协议接入，固件体积控制在 256KB Flash 以内。',
        relevance: 96,
        bulletIds: ['b1', 'b2']
      },
      {
        rank: 2,
        title: '无线组网问题的定位能力',
        text: '定位并解决 Zigbee 百节点组网丢包，丢包率从 12% 降到 0.8%。最终定位在射频时序与信道冲突——这是典型的「只有下过现场才会遇到」的问题。',
        relevance: 88,
        bulletIds: ['b4']
      },
      {
        rank: 3,
        title: '从产线到客户的闭环',
        text: '编写产线烧录与测试工装脚本，把单台测试从 6 分钟压到 90 秒；支持 20+ 客户完成现场接入，并参与过一次批量异常复盘，避免了约 30 万元潜在退货。',
        relevance: 82,
        bulletIds: ['b7', 'b8', 'b9']
      }
    ],
    avoid: [
      '建议隐去：实验室研究助理的经历只留「40+ 自动化测试用例」这一条，其余技术细节对本文岗没有增量',
      '别强调 Altium / PCB 设计能力——这个岗位不招硬件，提了反而让人怀疑你的方向'
    ],
    greeting: {
      text: '电子信息专业，懂 STM32 与 FreeRTOS，熟练用 lwIP 搭 MQTT/CoAP 双协议网关；有产线工装与 EMC 整改经验，能独立写部署文档',
      charCount: 62,
      angle: '低功耗设计与性能优化（有证据）',
      bulletIds: ['b1', 'b2', 'b6']
    },
    risks: [
      {
        text: '独立完成 IoT 网关固件开发',
        level: 'low',
        original: '原文为「基于 STM32F4 + FreeRTOS 开发智能家居网关固件」',
        question: '网关固件是你一个人写的还是团队？你的边界在哪、别人的边界在哪？'
      },
      {
        text: '参与过一次批量异常复盘',
        level: 'medium',
        original: '原文为「参与客户投诉的技术复盘」',
        question: '「参与」具体指什么？你推动了哪些决策？结论落地了吗？'
      },
      {
        text: '丢包率 12% → 0.8%',
        level: 'low',
        original: '原文数据一致，无外推',
        question: '百节点场景怎么复现的？怎么验证根因是射频时序而不是协议栈？'
      }
    ],
    interviewPrep: [
      { point: 'Linux 平台经验', hint: '诚实说没有生产环境经验，但 OS 调度和进程通信的概念是通的。想稳一点，花两天跑一个交叉编译 + 字符设备驱动的 demo，面试时能说"我自己搭过"。' },
      { point: '「参与复盘」的边界', hint: '提前想清楚：复盘是你发起的还是被安排的？你输出了什么？结论最后落地了没有？' },
      { point: '量产导入（NPI）', hint: '把 b7 展开：工装脚本怎么设计的、良率怎么统计、和产线怎么对接。这就是你的 NPI 经验，别自己先把它否掉。' },
      { point: '低功耗的具体手段', hint: '准备好说清三件事：用了哪几种休眠模式、外设怎么分级关断、唤醒源有哪些。' }
    ]
  }
};

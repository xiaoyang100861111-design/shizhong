namespace Shizhong.Api.Modules.Seed;

/// <summary>
/// Everything the generator writes as text: fictional Malaysian names (Chinese, Hokkien / Cantonese romanised,
/// English, Malay, Indian), cities / areas / streets / postcodes, bios, posts, comments, reviews, chats, live rooms,
/// tickets. All people are invented combinations; places are real public places (streets, malls, food streets).
/// </summary>
public static class SeedText
{
    // ------------------------------------------------------------------ names
    /// <summary>Chinese surname with the romanisations Malaysians actually write (Hokkien first, then Cantonese / Hakka / pinyin).</summary>
    public static readonly (string Zh, string[] Rom)[] Surnames =
    [
        ("陈", ["Tan", "Tan", "Chan", "Chen"]), ("林", ["Lim", "Lim", "Lam"]), ("黄", ["Wong", "Ng", "Ooi", "Huang"]), ("李", ["Lee", "Lee", "Li"]),
        ("张", ["Teo", "Chong", "Cheong", "Zhang"]), ("王", ["Ong", "Wong", "Wang"]), ("吴", ["Goh", "Ng", "Woo"]), ("刘", ["Lau", "Liew", "Low"]),
        ("蔡", ["Chua", "Choy", "Tsai"]), ("杨", ["Yeoh", "Yong", "Yeung"]), ("郑", ["Tay", "Cheng", "Chang"]), ("许", ["Koh", "Khor", "Hui"]),
        ("谢", ["Chia", "Tse", "Cheah"]), ("曾", ["Chan", "Tsang", "Chang"]), ("洪", ["Ang", "Hung"]), ("邱", ["Khoo", "Yau", "Hew"]),
        ("叶", ["Yap", "Yip", "Yeap"]), ("梁", ["Leong", "Neo", "Liang"]), ("罗", ["Loh", "Law", "Lo"]), ("何", ["Ho", "Hoh"]),
        ("胡", ["Foo", "Oh", "Hu"]), ("郭", ["Kuek", "Kwok", "Kok"]), ("苏", ["Soh", "So", "Su"]), ("萧", ["Siow", "Siew", "Seow"]),
        ("余", ["Yee", "Yu", "Ee"]), ("周", ["Chow", "Chew", "Chiew"]), ("徐", ["Chee", "Tsui", "Hsu"]), ("卢", ["Loo", "Lo", "Lu"]),
        ("方", ["Fong", "Pang", "Hong"]), ("钟", ["Chong", "Choong", "Cheong"]), ("温", ["Woon", "Voon", "Boon"]), ("赖", ["Lai", "Loy"]),
        ("彭", ["Phang", "Pang"]), ("廖", ["Liew", "Liau"]), ("江", ["Kang", "Kong"]), ("潘", ["Phuah", "Poon", "Pan"]),
        ("孙", ["Soon", "Sun"]), ("朱", ["Choo", "Chu"]), ("甘", ["Kam", "Gan"]), ("游", ["Yew", "Yu"]), ("傅", ["Foo", "Poh"]),
        ("严", ["Giam", "Yim"]), ("白", ["Pek", "Pai"]), ("沈", ["Sim", "Shum", "Shen"]), ("颜", ["Gan", "Ngan"]), ("庄", ["Chng", "Chong"]),
    ];

    public static readonly (string Zh, string Rom)[] MaleGiven =
    [
        ("伟明", "Wei Ming"), ("志豪", "Chee Hao"), ("俊杰", "Chun Kit"), ("家豪", "Ka Ho"), ("子轩", "Zi Xuan"), ("文杰", "Boon Kiat"),
        ("嘉俊", "Kah Chun"), ("国强", "Kok Keong"), ("振华", "Chin Wah"), ("健明", "Kian Meng"), ("耀文", "Yew Boon"), ("伟强", "Wai Keong"),
        ("宏亮", "Hong Leong"), ("俊宏", "Chun Hong"), ("立伟", "Lip Wei"), ("永康", "Yong Kang"), ("锦荣", "Kam Weng"), ("伟杰", "Wai Kit"),
        ("家伟", "Kah Wai"), ("俊贤", "Chun Hin"), ("志强", "Chee Keong"), ("建华", "Kian Hua"), ("德明", "Teck Meng"), ("伟龙", "Wai Loong"),
        ("子健", "Zi Jian"), ("承恩", "Seng Oon"), ("浩然", "Hao Ran"), ("宇航", "Yu Hang"), ("俊豪", "Jun Hao"), ("文彬", "Boon Pin"),
        ("振宇", "Zhen Yu"), ("嘉乐", "Ka Lok"), ("启明", "Kee Meng"), ("福来", "Hock Lai"), ("伟健", "Wei Kian"), ("晋升", "Chin Seng"),
        ("明辉", "Meng Hui"), ("金发", "Kim Huat"), ("荣华", "Eng Hua"), ("俊彦", "Chun Yen"), ("家乐", "Jia Le"), ("思远", "Si Yuan"),
    ];

    public static readonly (string Zh, string Rom)[] FemaleGiven =
    [
        ("美玲", "Mei Ling"), ("慧敏", "Hui Min"), ("丽华", "Lai Wah"), ("淑芬", "Siok Hoon"), ("佩琪", "Pei Qi"), ("欣怡", "Xin Yi"),
        ("雅婷", "Ya Ting"), ("思敏", "Sze Min"), ("嘉欣", "Kah Yan"), ("咏琪", "Wing Kei"), ("秀英", "Siew Ying"), ("丽珠", "Lai Chu"),
        ("慧玲", "Hui Ling"), ("家怡", "Jia Yi"), ("晓雯", "Xiao Wen"), ("静怡", "Jing Yi"), ("婉婷", "Wan Ting"), ("心怡", "Sin Yee"),
        ("紫琳", "Zi Lin"), ("诗琪", "Shi Qi"), ("凯琳", "Kai Lin"), ("宝仪", "Po Yee"), ("翠萍", "Chui Ping"), ("玉莲", "Geok Lian"),
        ("月娥", "Guat Ngoh"), ("美华", "Bee Hua"), ("爱玲", "Ai Ling"), ("瑞琪", "Swee Kee"), ("玉玲", "Yoke Ling"), ("丽萍", "Lay Peng"),
        ("佳慧", "Jia Hui"), ("雪莹", "Suet Ying"), ("惠珊", "Wai San"), ("敏仪", "Man Yee"), ("芷晴", "Zhi Qing"), ("诗雅", "Si Ya"),
        ("晓琳", "Xiao Lin"), ("燕玲", "Yin Ling"), ("淑仪", "Suk Yee"), ("丽玲", "Li Ling"), ("雅琳", "Nga Lam"), ("秀玲", "Siew Ling"),
    ];

    public static readonly string[] MaleEnglish =
    [
        "Jason", "Kelvin", "Alvin", "Desmond", "Marcus", "Ryan", "Brian", "Eric", "Jonathan", "Daniel", "Nicholas", "Wilson", "Jeffrey",
        "Benjamin", "Terence", "Shawn", "Ivan", "Justin", "Raymond", "Vincent", "Edwin", "Gary", "Dennis", "Kenneth", "Adrian", "Calvin",
        "Jimmy", "Aaron", "Sean", "Leon", "Bryan", "Melvin", "Darren", "Jayden", "Ethan", "Wesley",
    ];

    public static readonly string[] FemaleEnglish =
    [
        "Mandy", "Joanne", "Rachel", "Cheryl", "Jasmine", "Vivian", "Michelle", "Carmen", "Yvonne", "Stephanie", "Jacqueline", "Sharon",
        "Winnie", "Evelyn", "Amanda", "Chloe", "Karen", "Elaine", "Crystal", "Wendy", "Joey", "Serene", "Jolene", "Irene", "Angeline",
        "Belinda", "Cindy", "Grace", "Hazel", "Janice", "Queenie", "Rebecca", "Tiffany", "Zoe", "Nicole", "Sabrina",
    ];

    public static readonly string[] MalayFirstM = ["Muhammad", "Ahmad", "Mohd", "Amirul", "Syafiq", "Faris", "Khairul", "Nazrul", "Haziq", "Irfan", "Aiman", "Firdaus", "Hafiz", "Danial", "Izzat", "Azman", "Rizal", "Farhan", "Luqman", "Hakim"];
    public static readonly string[] MalayFirstF = ["Nurul", "Nur", "Farah", "Aina", "Syazwani", "Atiqah", "Nadia", "Hani", "Liyana", "Aqilah", "Sofia", "Balqis", "Amira", "Izzah", "Hidayah", "Aisyah", "Najwa", "Alya", "Hanis", "Qistina"];
    public static readonly string[] MalaySecondM = ["Hakim", "Iskandar", "Danial", "Anuar", "Izwan", "Rahman", "Zakaria", "Hakimi", "Kamal", "Aziz", "Rahim", "Sulaiman", "Yusof", "Hamid", "Mazlan", "Ismail", "Hassan", "Othman", "Zainal", "Razak", "Idris", "Haziq", "Aiman", "Syazwan"];
    public static readonly string[] MalaySecondF = ["Aisyah", "Izzati", "Adibah", "Sofea", "Farhana", "Amani", "Nabila", "Syahirah", "Husna", "Batrisyia", "Humaira", "Insyirah", "Nadhirah", "Rahman", "Yusof", "Hamid", "Aziz", "Zakaria"];
    public static readonly string[] MalaySecond = ["Aisyah", "Izzati", "Adibah", "Sofea", "Hakim", "Iskandar", "Danial", "Anuar", "Izwan", "Rahman", "Zakaria", "Hakimi", "Kamal", "Aziz", "Rahim", "Farhana", "Sulaiman", "Yusof", "Hamid", "Mazlan", "Amani", "Ismail", "Hassan", "Othman", "Zainal", "Razak", "Idris", "Nabila", "Syahirah", "Husna"];
    public static readonly string[] IndianFirstM = ["Arun", "Suresh", "Ravi", "Karthik", "Vignesh", "Prakash", "Dinesh", "Ganesh", "Harish", "Kumaran", "Saravanan", "Rajesh", "Mohan", "Naveen", "Thinesh", "Jaspal"];
    public static readonly string[] IndianFirstF = ["Kavitha", "Priya", "Deepa", "Thivya", "Meena", "Shalini", "Anitha", "Revathi", "Janani", "Sangeetha", "Malini", "Yogeswari", "Keerthana", "Harpreet", "Nisha", "Pavithra"];
    public static readonly string[] IndianLast = ["Kumar", "Raj", "Nair", "Menon", "Pillai", "Rao", "Chandran", "Selvam", "Krishnan", "Muniandy", "Subramaniam", "Ramasamy", "Singh", "Kaur", "Arumugam", "Devi", "Letchumi", "Murugan"];
    public static readonly string[] MalayMale = ["Muhammad Hafiz", "Ahmad Faiz", "Mohd Azlan", "Amirul Hakim", "Syafiq Iskandar", "Faris Danial", "Khairul Anuar", "Nazrul Izwan", "Haziq Rahman", "Irfan Zakaria", "Aiman Hakimi", "Firdaus Kamal"];
    public static readonly string[] MalayFemale = ["Nurul Aisyah", "Nur Izzati", "Farah Adibah", "Aina Sofea", "Syazwani Aziz", "Atiqah Rahim", "Nadia Farhana", "Hani Sulaiman", "Liyana Yusof", "Aqilah Hamid", "Sofia Mazlan", "Balqis Amani"];
    public static readonly string[] IndianMale = ["Arun Kumar", "Suresh Nair", "Ravi Chandran", "Karthik Raj", "Vignesh Rao", "Prakash Menon", "Dinesh Pillai", "Ganesh Murthy", "Harish Selvam"];
    public static readonly string[] IndianFemale = ["Kavitha Raj", "Priya Devi", "Deepa Menon", "Thivya Nair", "Meena Letchumi", "Shalini Kaur", "Anitha Muniandy", "Revathi Subra", "Janani Krishnan"];

    public static readonly string[] NickZh =
    [
        "阿明", "阿杰", "小雨", "小鱼儿", "阿伦", "小熊", "阿伟", "小咪", "阿May", "饭团", "糯米", "阿豪", "小胖", "喵喵酱", "小叮当", "阿Ben",
        "KL小吃货", "槟城阿伦", "新山小妹", "怡保老街仔", "马六甲阿婷", "吃货Wendy", "爱跑步的阿杰", "咖啡续命中", "周末不宅", "椰浆饭爱好者",
        "阿发", "小白兔", "Kopi阿哥", "榴莲控", "打工人阿文", "星星", "晴天", "慢慢来", "阿Sam", "小橙子", "Ah Boy", "阿妹",
    ];

    public static readonly string[] EmailDomains = ["gmail.com", "gmail.com", "gmail.com", "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "live.com.my", "ymail.com"];

    // ------------------------------------------------------------------ places
    public sealed record Area(string Zh, string En, string Postcode, string[] Streets);
    public sealed record City(string Zh, string En, string CityId, double Lat, double Lng, string State, Area[] Areas, string[] Places, string[] Condos);

    public static readonly City[] Cities =
    [
        new("吉隆坡", "Kuala Lumpur", "76497", 3.1390, 101.6869, "Wilayah Persekutuan Kuala Lumpur",
        [
            new("武吉免登", "Bukit Bintang", "55100", ["Jalan Alor", "Jalan Nagasari", "Jalan Changkat Bukit Bintang", "Jalan Tengkat Tong Shin"]),
            new("蕉赖", "Cheras", "56000", ["Jalan Cerdas", "Jalan Midah 1", "Jalan Kaskas", "Jalan Manis 4"]),
            new("甲洞", "Kepong", "52100", ["Jalan Metro Perdana Barat", "Jalan Rimbunan Raya", "Jalan Desa 1/3", "Jalan Kepong"]),
            new("孟沙", "Bangsar", "59100", ["Jalan Telawi 3", "Jalan Maarof", "Lorong Kurau", "Jalan Ara"]),
            new("满家乐", "Mont Kiara", "50480", ["Jalan Kiara", "Jalan Kiara 3", "Jalan Solaris"]),
            new("旧巴生路", "Old Klang Road", "58100", ["Jalan Klang Lama", "Jalan Sri Sentosa", "Jalan Kuchai Maju 6"]),
            new("大城堡", "Sri Petaling", "57000", ["Jalan Radin Bagus", "Jalan Radin Tengah", "Jalan Radin Anum 1"]),
            new("冼都", "Sentul", "51000", ["Jalan Sentul", "Jalan Strachan", "Jalan Sentul Pasar"]),
            new("安邦", "Ampang", "68000", ["Jalan Mamanda 9", "Jalan Merdeka", "Jalan Ampang Utama"]),
            new("敦依斯迈花园", "Taman Tun Dr Ismail", "60000", ["Jalan Tun Mohd Fuad 3", "Lorong Rahim Kajai 14", "Jalan Wan Kadir 2"]),
        ],
        ["茨厂街", "Jalan Alor 美食街", "孟沙", "Pavilion KL", "KLCC 公园", "甲洞美食中心", "蕉赖 Cheras Leisure Mall", "TRX", "Mid Valley", "大城堡夜市"],
        ["Residensi Kiara", "Pangsapuri Sri Cempaka", "The Vertical Suites", "Pavilion Residences", "Taman Midah Condo", "Kepong Sentral Residence"]),
        new("八打灵再也", "Petaling Jaya", "76543", 3.1073, 101.6067, "Selangor",
        [
            new("SS2", "SS2", "47300", ["Jalan SS 2/24", "Jalan SS 2/55", "Jalan SS 2/72"]),
            new("白沙罗乌打", "Damansara Utama", "47400", ["Jalan SS 21/37", "Jalan SS 21/1A", "Jalan SS 21/58"]),
            new("哥打白沙罗", "Kota Damansara", "47810", ["Jalan PJU 5/1", "Jalan Teknologi", "Jalan PJU 5/16"]),
            new("梳邦再也", "Subang Jaya", "47500", ["Jalan SS 15/4", "Jalan USJ 9/5", "Jalan SS 18/6"]),
            new("双威", "Bandar Sunway", "47500", ["Jalan PJS 11/28", "Jalan Lagoon Selatan", "Jalan PJS 11/7"]),
            new("旧八打灵", "Petaling Jaya Old Town", "46000", ["Jalan Othman", "Jalan 1/11", "Jalan Templer"]),
            new("蒲种", "Puchong", "47100", ["Jalan Kenari 5", "Jalan Puteri 5/1", "Jalan BK 5A/2"]),
            new("十七区", "Seksyen 17", "46400", ["Jalan 17/29", "Jalan 17/45", "Jalan 17/1"]),
        ],
        ["SS2 夜市", "1 Utama", "Sunway Pyramid", "Paradigm Mall", "双威湖", "白沙罗乌打 Uptown", "旧八打灵咖啡店", "The Starling"],
        ["Pangsapuri Mentari", "Tropicana Gardens", "Sunway Geo Residences", "Menara Damansara", "Kelana Puteri", "Puchong Perdana Court"]),
        new("槟城", "Penang", "76447", 5.4141, 100.3288, "Pulau Pinang",
        [
            new("乔治市", "George Town", "10200", ["Lebuh Chulia", "Lebuh Armenian", "Jalan Penang", "Lebuh Campbell"]),
            new("亚依淡", "Air Itam", "11500", ["Jalan Air Itam", "Jalan Pasar", "Lorong Kampung Pisang"]),
            new("浮罗池滑", "Pulau Tikus", "10350", ["Jalan Burma", "Jalan Cantonment", "Lorong Pulau Tikus"]),
            new("峇六拜", "Bayan Lepas", "11900", ["Jalan Mahsuri", "Lebuh Bukit Kecil 6", "Jalan Tengah"]),
            new("日落洞", "Jelutong", "11600", ["Jalan Jelutong", "Jalan Perak", "Lebuh Kampung Jawa"]),
            new("丹绒道光", "Tanjung Tokong", "10470", ["Jalan Tanjung Tokong", "Persiaran Seri Tanjung Pinang", "Lebuh Sungai Pinang"]),
            new("垄尾", "Gelugor", "11700", ["Jalan Gelugor", "Lintang Delima", "Jalan Sultan Azlan Shah"]),
            new("大山脚", "Bukit Mertajam", "14000", ["Jalan Kulim", "Jalan Pasar", "Jalan Permatang Rawa"]),
            new("北海", "Butterworth", "12000", ["Jalan Bagan Luar", "Jalan Raja Uda", "Jalan Chain Ferry"]),
        ],
        ["汕头街", "新关仔角", "升旗山", "姓周桥", "乔治市壁画街", "Gurney Plaza", "峇六拜夜市", "亚依淡极乐寺"],
        ["Straits Quay Residences", "Pangsapuri Mutiara", "Gurney Paragon Residences", "Taman Sri Nibong Apartment", "Arena Residence"]),
        new("新山", "Johor Bahru", "76455", 1.4927, 103.7414, "Johor",
        [
            new("新山市中心", "Johor Bahru City", "80000", ["Jalan Wong Ah Fook", "Jalan Dhoby", "Jalan Trus"]),
            new("士古来", "Skudai", "81300", ["Jalan Hang Tuah", "Jalan Pendidikan", "Jalan Sutera Tanjung"]),
            new("地不佬", "Tebrau", "81100", ["Jalan Harmonium", "Jalan Mutiara Emas 2", "Jalan Tebrau"]),
            new("大丰花园", "Taman Daya", "81100", ["Jalan Sagu 18", "Jalan Pinang 3", "Jalan Nipah"]),
            new("武吉英达", "Bukit Indah", "81200", ["Jalan Indah 15", "Jalan Indah 24", "Jalan Indah Utama"]),
            new("彩虹花园", "Taman Pelangi", "80400", ["Jalan Kuning", "Jalan Serampang", "Jalan Kuning Dua"]),
            new("百万镇", "Taman Molek", "81100", ["Jalan Molek 1/29", "Jalan Molek 2/4", "Jalan Molek 3/10"]),
            new("依斯干达公主城", "Iskandar Puteri", "79100", ["Jalan Laksamana", "Persiaran Afiat", "Jalan Ekoflora"]),
        ],
        ["新山古庙", "Paradigm Mall JB", "Danga Bay", "陈旭年文化街", "Mid Valley Southkey", "百万镇美食街", "士古来夜市"],
        ["R&F Princess Cove", "Pangsapuri Suria Molek", "Setia Tropika Villa", "Twin Tower Residences", "Pangsapuri Sri Skudai"]),
        new("马六甲", "Melaka", "76520", 2.1896, 102.2501, "Melaka",
        [
            new("马六甲市区", "Melaka City", "75000", ["Jalan Hang Jebat", "Jalan Tokong", "Jalan Bendahara"]),
            new("哥打叻沙玛纳", "Kota Laksamana", "75200", ["Jalan KL 3/8", "Jalan KL 1/5", "Jalan KL 2/9"]),
            new("爱极乐", "Ayer Keroh", "75450", ["Jalan Ayer Keroh Lama", "Jalan TU 43", "Jalan Plaza"]),
            new("马六甲拉也", "Melaka Raya", "75000", ["Jalan Merdeka", "Jalan PM 4", "Jalan MR 1"]),
            new("武吉巴汝", "Bukit Baru", "75150", ["Jalan Bukit Baru", "Jalan BB 1", "Jalan Delima"]),
        ],
        ["鸡场街", "荷兰红屋", "马六甲河", "葡萄牙村", "Mahkota Parade", "鸡场街夜市"],
        ["Pangsapuri Bayu Mahkota", "Silverscape Residence", "Taman Asean Apartment", "The Wave Residence"]),
        new("怡保", "Ipoh", "76450", 4.5975, 101.0901, "Perak",
        [
            new("怡保旧街场", "Ipoh Old Town", "30000", ["Jalan Bandar Timah", "Jalan Sultan Yussuf", "Jalan Panglima"]),
            new("新街场", "Ipoh New Town", "30300", ["Jalan Sultan Idris Shah", "Jalan Yang Kalsom", "Jalan Mustapha Al-Bakri"]),
            new("坎宁花园", "Canning Garden", "31400", ["Persiaran Canning", "Jalan Merpati", "Jalan Tambun"]),
            new("万里望", "Menglembu", "31450", ["Jalan Menglembu", "Jalan Lahat", "Jalan Besar"]),
            new("狮尾", "Silibin", "30100", ["Jalan Silibin", "Jalan Kuala Kangsar", "Persiaran Silibin"]),
            new("兵如港", "Pasir Pinji", "31650", ["Jalan Pasir Puteh", "Jalan Pasir Pinji", "Jalan Kampar"]),
        ],
        ["怡保旧街场", "二奶巷", "天空之镜 Tasik Cermin", "极乐洞", "怡保火车站", "新街场芽菜鸡"],
        ["Pangsapuri Majestic", "Taman Canning Apartment", "Kinta Riverfront Residence", "D'Festivo Residence"]),
    ];

    // ------------------------------------------------------------------ profile
    public static readonly string[] Interests = ["food", "travel", "fitness", "music", "movies", "gaming", "pets", "photography", "shopping", "parenting", "study", "career", "beauty", "homeLife"];

    public static readonly string[] Occupations =
    [
        "会计", "软件工程师", "护士", "老师", "销售", "设计师", "物流主管", "餐厅经理", "行政助理", "自由职业", "大学生", "市场专员", "银行职员",
        "理发师", "司机", "药剂师", "客服", "房产经纪", "工厂主管", "咖啡师", "电工", "装修师傅", "营养师", "摄影师", "保险顾问", "小生意老板",
    ];

    public static readonly string[] Bios =
    [
        "在{area}上班的打工人，周末喜欢找好吃的。", "{city}人，喜欢咖啡、猫和慢跑。", "爱吃榴莲的{city}人🍈", "下班就想躺平，周末出去走走。",
        "喜欢拍照，也喜欢把日子过得慢一点。", "健身三年，偶尔偷懒。", "一个人也要好好吃饭。", "早餐一定要有半生熟蛋和咖啡。",
        "喜欢旅行，去过十几个国家，下一站是日本。", "新手妈妈，记录宝宝的日常。", "在学吉他，欢迎一起玩音乐🎸", "猫奴一枚，家里有两只橘猫。",
        "周末常去{place}，一起吗？", "认真工作，认真吃饭。", "不定期分享{city}好吃的小店。", "喜欢爬山和露营⛺", "正在练习马来语，Saya suka makan!",
        "打羽毛球的来约～", "咖啡续命中☕", "做事慢，但是很认真。", "希望每天都有好心情。", "热爱生活，也热爱美食。", "刚搬来{city}，想认识新朋友。",
        "白天做设计，晚上追剧。", "喜欢海边和日落🌅", "老街控，喜欢老店的味道。", "在{area}开小店，欢迎来坐坐。", "平时爱煮饭，也爱分享食谱。",
        "喜欢安静的咖啡馆和书。", "跑步爱好者，目标是跑一次全马。", "每天都在找好吃的椰浆饭。", "带狗狗散步是每天最开心的时间🐶",
        "Foodie. Coffee lover. Based in {cityEn}.", "Weekend hiker, weekday coder.", "Love durian, hate traffic jams 😂", "Just here to make friends.",
        "Badminton on Tuesdays, mamak after 🏸", "Cat person. Plant parent. {cityEn}.", "Learning to cook one recipe a week.", "Sunset chaser 🌅", "Work hard, travel harder ✈️",
        "Teh tarik > coffee. Fight me.", "New to {cityEn}, say hi!",
        "Suka makan dan travel ✈️", "Kopi o kosong please ☕",
    ];

    // ------------------------------------------------------------------ posts
    public static readonly string[] Foods =
    [
        "肉骨茶", "椰浆饭", "炒粿条", "咖喱叻沙", "云吞面", "咖喱面", "海南鸡饭", "煎蕊", "印度煎饼", "沙爹", "福建面", "虾面", "板面", "酿豆腐",
        "芽菜鸡", "白咖啡", "美禄恐龙", "榴莲", "猪肠粉", "鸡饭粒", "娘惹糕", "海南咖啡", "瓦煲鸡饭", "炒果条", "亚参叻沙", "椰丝球", "干捞面",
    ];

    public static readonly string[] PostFood =
    [
        "终于吃到{place}那家排队的{food}，汤底真的够浓👍", "今天的早餐是{food}+一杯冰咖啡，完美。", "下雨天就是要吃一碗热热的{food}。",
        "朋友推荐的{food}，果然没有让我失望。", "{city}的{food}还是最对我的胃口。", "为了这碗{food}排了四十分钟，值得！", "午餐随便吃，结果{food}意外好吃😋",
        "妈妈煮的{food}永远是第一名。", "发现一家新开的小店，{food}很有古早味。", "宵夜时间，{food}走起～", "今天挑战自己做{food}，第一次还不错吧？",
        "周末 brunch：班兰松饼 + 拿铁，心情变好了。", "第三次来这家店了，老板都认得我了哈哈。",
    ];
    public static readonly string[] PostLife =
    [
        "下班回家路上看到的晚霞，今天也辛苦了。", "终于把房间整理好了，看着就舒服。", "今天加班到九点，回家路上买了杯凉茶奖励自己。",
        "养了三个月的绿萝终于冒新芽了🌱", "阳台的风很舒服，泡杯茶发个呆。", "新买的咖啡机到了，明天开始在家做拿铁。", "早起跑了五公里，一整天都很有精神。",
        "和老同学吃饭，聊到半夜还舍不得走。", "猫主子今天又把我的纸箱占了。", "今天的小确幸：地铁上有位子坐。", "周一综合症发作中，谁来救救我😂",
        "搬家第一周，终于习惯新的通勤路线了。", "生日收到很多祝福，谢谢大家❤️",
    ];
    public static readonly string[] PostWeekend =
    [
        "周末带爸妈去{place}走走，天气刚好不太热。", "一早出发去{place}，人还不多，很舒服。", "周末去{place}拍照，随手一拍都好看。",
        "周六的计划：睡到自然醒，然后去{place}喝咖啡。", "跟朋友去露营，晚上的星星好多⛺", "周末短途去了{city}，吃了一整天。",
        "逛了一整天{place}，腿断了但很开心。", "周末做志愿者，帮忙整理社区图书馆。", "今天去打羽毛球，出了一身汗。", "带狗狗去公园玩，它比我还兴奋🐶",
    ];
    public static readonly string[] PostDaily =
    [
        "马来西亚的雨说来就来，出门记得带伞☔", "今天去 JPJ 办事，比想象中快。", "油价又调整了，大家加油前看一下。", "早上塞车塞到怀疑人生。",
        "去巴刹买菜，老板多送了一把葱。", "学了一句新的马来语：Terima kasih banyak！", "这几天好热，大家记得多喝水。", "开斋节快到了，商场都布置得好漂亮。",
        "今天第一次用手机充值话费，几秒就到了，方便。", "中秋快到了，公司发了月饼🥮", "Grab 司机大哥聊了一路，原来是同乡。", "排队买彩虹蛋糕的人好多。",
    ];
    public static readonly string[] PostCity =
    [
        "{city}的夜景还是那么好看。", "每次路过{place}都会停下来拍一张。", "在{city}住了五年，还是会被这里的老街打动。", "{place}的日落，今天特别美。",
        "带外地朋友逛{place}，他们都说下次还要来。", "雨后的{city}空气好清新。", "清晨的{place}，安静得只听到鸟叫。", "{city}的壁画街又多了几幅新作品。",
    ];

    public static readonly string[] PostPhotosFood =
    [
        "photos/chicken-satay.webp", "photos/chicken-curry.webp", "photos/cafe-toast.webp", "photos/basil-pizza.webp", "photos/bakery-bread.webp",
        "photos/celebration-cake.webp", "nasi-lemak.webp", "cafe-brunch.webp", "fresh-fruit.webp", "cake-table.webp",
    ];
    public static readonly string[] PostPhotosCity = ["city-kl.webp", "photos/airport-traveler.webp", "cafe-brunch.webp", "photos/cafe-baristas.webp"];
    public static readonly string[] PostPhotosLife = ["clean-home.webp", "cafe-brunch.webp", "photos/cafe-baristas.webp", "fresh-fruit.webp", "hair-salon.webp"];

    public static readonly string[] Comments =
    [
        "看起来好好吃！在哪里？", "下次带我去😂", "好美啊", "这家我也去过，真的不错", "周末一起吗？", "哈哈哈太真实了", "收藏了", "羡慕…",
        "天气真的好热", "拍得好好看，用什么手机拍的？", "求地址🙏", "我上次去排了好久", "早安～", "加油！", "太可爱了吧", "口水流下来了🤤",
        "同感！", "这个价钱还可以", "下次记得叫我", "看到就饿了", "好久没去了，好怀念", "你家猫好肥哈哈", "这里晚上更好看", "周末人会很多，早点去",
        "Wah nice!", "Sedapnya!", "Looks so good 😍", "赞👍", "我也想要", "哈哈我也是这样", "注意安全哦", "生日快乐🎂", "辛苦了，早点休息",
        "这家的冰咖啡也很好喝", "我住附近，推荐隔壁那家", "期待下一篇分享", "照片好有感觉", "请问要预约吗？",
    ];

    // ------------------------------------------------------------------ reviews
    public static readonly Dictionary<string, string[]> ReviewGood = new()
    {
        ["food"] = ["送来还是热的，份量足，下次还点。", "参巴很香，辣度刚好，鸡翅炸得很脆。", "骑手很快，汤一点都没洒出来。", "味道很正宗，跟店里吃的一样。", "包装很用心，还多送了一包辣椒。", "午餐时间也很快送到，推荐！"],
        ["market"] = ["蔬菜很新鲜，鸡蛋一个都没破。", "送货很准时，水果都挑得很好。", "价格比超市便宜一点，东西也新鲜。", "下单一个小时就送到了，太方便。", "日用品一次买齐，不用自己搬了。"],
        ["flower"] = ["花很新鲜，包装也很漂亮，女朋友很喜欢。", "蛋糕口感很好，不会太甜，家人都说好吃。", "准时送到，卡片上的字也写得很工整。", "比照片还好看，下次纪念日还会找这家。"],
        ["clean"] = ["阿姨很细心，厨房油污都清得很干净。", "准时到，做事很有条理，推荐。", "冷气洗完真的凉了很多，师傅还帮忙检查了漏水。", "搬家前的深度清洁，效果超出预期。"],
        ["repair"] = ["师傅很专业，冷气修好了还教我怎么保养。", "来之前先打电话确认，很准时。", "价格透明，没有乱收费。", "热水器问题半小时就解决了。"],
        ["beauty"] = ["美甲款式很好看，维持了三个星期。", "理发师很有耐心，剪得很满意。", "环境干净，手法很舒服。", "做完脸皮肤明显亮了，会回购。"],
        ["car"] = ["司机提早到机场，还帮忙搬行李。", "车很干净，开车很稳。", "半夜的航班也准时来接，很安心。", "司机很熟路，避开了塞车。"],
        ["guide"] = ["地陪很熟悉路线，带我们吃了很多本地人才知道的店。", "讲解很有趣，小朋友都听得很入迷。", "行程安排得刚刚好，不会太累。", "拍照技术也很好，帮我们拍了很多美照。"],
        ["travel"] = ["行程安排得很合理，不会太赶。", "酒店位置很方便，性价比高。", "客服回复很快，有问题马上处理。", "一日游很充实，导游很用心。"],
        ["delivery"] = ["跑腿很快，半小时就送到了。", "帮忙代买的东西都没有错，很细心。", "文件准时送到，还拍照给我确认。"],
        ["phone"] = ["充值秒到账，很方便。", "话费马上到了，下次还用。", "操作简单，比去店里快多了。"],
        ["_"] = ["服务很好，推荐给大家。", "整体很满意，下次还会再来。", "沟通顺畅，体验很好。", "物有所值，五星好评。", "比预期的好，谢谢！"],
    };
    public static readonly string[] ReviewOk = ["还不错，就是等了比较久。", "整体可以，价格稍微贵一点。", "味道还行，份量可以再多一点。", "服务态度好，但是迟到了十分钟。", "东西不错，包装可以再改进。"];
    public static readonly string[] ReviewMeh = ["一般般，没有想象中好。", "比店里的淡一点，送到有点凉了。", "时间改了两次，有点麻烦。", "效果普通，价格偏高。"];
    public static readonly string[] ReviewBad = ["送到的时候已经凉了，而且少了一份饮料。", "迟到了一个小时，也没有提前通知。", "和描述的不一样，有点失望。", "服务态度不太好，不会再点了。"];
    public static readonly string[] ReviewReplies =
    [
        "谢谢您的支持，期待再次为您服务！", "感谢好评，我们会继续努力～", "抱歉让您久等了，我们会改进配送时间。", "谢谢反馈，已经提醒师傅注意。",
        "非常感谢！下次来店里报名字有小惊喜哦。", "不好意思给您带来不便，已联系您处理。",
    ];
    public static readonly Dictionary<string, string[]> ReviewTags = new()
    {
        ["food"] = ["onTime", "value", "again"], ["market"] = ["onTime", "value", "again"], ["flower"] = ["onTime", "tidy", "again"],
        ["clean"] = ["professional", "tidy", "onTime", "friendly"], ["repair"] = ["professional", "onTime", "value"], ["beauty"] = ["professional", "friendly", "tidy"],
        ["car"] = ["onTime", "friendly", "professional"], ["guide"] = ["friendly", "professional", "again"], ["travel"] = ["value", "professional", "again"],
        ["delivery"] = ["onTime", "friendly"], ["phone"] = ["onTime", "value"],
    };

    public static readonly string[] OrderNotes = ["麻烦到楼下打电话给我", "请不要放香菜", "少辣，谢谢", "放在门口就可以", "保安室代收", "请准时到，谢谢", "有狗狗，进门前按门铃", "需要收据", "", "", "", "", "", ""];

    // ------------------------------------------------------------------ chats
    /// <summary>Short 1:1 conversations between members (alternating lines, a = starter).</summary>
    public static readonly string[][] DirectScripts =
    [
        ["哈喽～最近怎样？", "还不错，刚下班。你呢？", "我在找吃的哈哈", "你附近那家{food}不错，可以试试", "好啊，下次一起？", "OK！周末约"],
        ["周末有空吗？想去{place}走走", "周六下午可以", "那两点在门口等？", "好，我带伞，最近天气怪怪的", "👍"],
        ["你上次说的那家清洁服务叫什么？", "在适中上面找的，阿姨很仔细", "我也订一个，家里乱到不行😂", "记得选早上的时段，人比较少"],
        ["生日快乐🎂！", "谢谢你还记得😭", "晚上吃什么好料？", "家里人订了蛋糕，简单庆祝一下"],
        ["明天的羽毛球还打吗？", "打！七点老地方", "我多带一支拍子", "好，顺便叫阿杰"],
        ["刚刚看到你发的照片，那是{place}吗？", "对呀，周末去的", "好漂亮，下次也想去", "早上去人比较少，推荐"],
        ["你有推荐的修冷气师傅吗？", "我上个月在 app 上叫的，挺专业", "价钱怎样？", "RM 80 左右，还帮我洗了一下"],
        ["下个月一起去槟城吗？", "可以啊，我请两天假", "我来看看住宿", "记得吃炒粿条和煎蕊！"],
        ["在吗？", "在的", "借我一下你的 Netflix 账号密码😂", "哈哈哈 晚点发你"],
        ["早安☀️", "早～今天好热", "我已经在冷气房里了哈哈", "羡慕"],
        ["那家{food}我去吃了！", "怎样怎样？", "真的好吃，谢谢推荐", "我就说吧😎"],
        ["你家附近有推荐的补习老师吗", "我表姐在教数学，要问她吗", "好啊，麻烦你了", "我把她的联络发你"],
        ["今天的红包抢到了吗哈哈", "只抢到一块钱😂", "我抢到五块", "手快有手慢无"],
        ["晚上要不要一起打游戏", "几点？", "十点", "OK 我先吃饭"],
    ];

    public static readonly string[] GroupLines =
    [
        "大家早安～", "这周末谁要一起去{place}？", "我可以！", "+1", "几点集合？", "我晚点到", "有人知道{place}附近好停车吗", "推荐搭 LRT 比较方便",
        "上次那家{food}真的好吃", "下次换一家试试", "今天下雨还去吗？", "照去，室内的", "新人报到，请多指教🙏", "欢迎欢迎", "照片已经上传到相册了",
        "谢谢组织的朋友辛苦了", "这周谁带饮料？", "我带", "哈哈哈", "👍👍", "收到", "明天见！", "路上小心", "有人要拼车吗", "我从{area}出发，可以载两位",
    ];

    public static readonly (string Q, string A)[] SupportThreads =
    [
        ("你好，我刚刚用 USDT 充值，还没到账", "您好，加密货币充值需要等待区块确认，TRC20 一般 1–3 分钟。请提供交易哈希，我们帮您查一下。"),
        ("请问提现要多久审核？", "您好，提现提交后 1–3 个工作日内审核打款，工作日下午 5 点前提交的一般当天处理。"),
        ("我的订单可以改时间吗？", "可以的，请告诉我们订单号和想改的时间，我们联系商家帮您调整。"),
        ("退款什么时候到账？", "退款会原路退回到适中钱包，一般即时到账。您可以在「钱包 › 账单」里查看退款记录。"),
        ("怎么修改绑定的手机号？", "您好，请到「设置 › 账号与安全」修改手机号，需要输入当前密码验证。"),
        ("金豆可以换回现金吗？", "您好，金豆只用于送礼和购买装扮，暂不支持换回现金哦。"),
        ("我想申请做主播，需要什么条件？", "您好，在「直播 › 申请主播」填写资料即可，审核一般 1–2 个工作日，年满 18 岁即可申请。"),
        ("有人在聊天里一直骚扰我", "非常抱歉给您带来不好的体验。您可以在对方主页点「举报」并选择「拉黑」，我们会尽快核查处理。"),
        ("线下转账充值提交了，什么时候入账？", "您好，财务核对银行到账后为您入账，工作日一般 1 小时内。请确认转账备注填写了您的用户 ID。"),
        ("为什么我的动态被隐藏了？", "您好，这条动态被多位用户举报，经审核含有引流信息。如有疑问可以回复说明，我们会再次核查。"),
        ("新人券怎么用？", "新人券满 RM 80 可用，下单时会自动选择最优优惠券，有效期 30 天。"),
        ("商家一直没有确认我的订单", "您好，已帮您催促商家。如 2 小时内仍未确认，您可以直接取消订单，款项会全额退回钱包。"),
    ];
    public static readonly string[] SupportFollowUps = ["好的，谢谢", "收到，我再等等", "已经到账了，谢谢！", "明白了", "麻烦你们了🙏", "好的，交易哈希我发给你"];
    public static readonly string[] SupportNudges = ["在吗？", "麻烦帮忙看一下，谢谢🙏", "有人吗", "等你们回复", "急，谢谢！", "Hello? Anyone there?"];
    public static readonly string[] DeskClosers = ["不客气，还有其他问题随时找我们～", "已为您处理完成，祝您生活愉快！", "感谢您的耐心等待。"];

    public static readonly (string Q, string A)[] MerchantThreads =
    [
        ("请问今天可以送到{area}吗？", "可以的，下午 4 点前下单当天送达。"),
        ("可以提早一点到吗？", "好的，师傅会尽量提早，到之前会先打电话给您。"),
        ("有没有无糖的选择？", "有的，下单备注「无糖」就可以了。"),
        ("请问需要自己准备工具吗？", "不用，我们会带齐所有工具和清洁用品。"),
        ("可以开发票吗？", "可以，完成后会把电子收据发到这里。"),
        ("周末也营业吗？", "周末照常营业，早上 9 点到晚上 9 点。"),
    ];

    public static readonly string[] PersonaReplies =
    [
        "你好呀～很高兴认识你😊", "哈哈，我也喜欢！", "最近在忙什么呢？", "周末我一般会去附近走走", "这个我也想试试看", "谢谢你的分享～",
        "今天有点累，但看到你的消息很开心", "你也是{city}的吗？", "有空一起聊聊", "晚安，早点休息哦🌙",
    ];
    public static readonly string[] PersonaOpeners = ["你好，看到你的主页很有意思", "嗨～你也喜欢旅行吗？", "你好！可以交个朋友吗", "你推荐的地方我去了，很不错！", "晚上好～"];

    public static readonly string[] Emojis = ["😄", "🥰", "👍", "🤗", "😂", "🙏", "❤️", "😋", "🎉", "😴"];

    public static readonly string[] PacketNotes = ["恭喜发财，大吉大利", "恭喜发财，大吉大利", "周末愉快", "请大家喝咖啡☕", "中秋快乐🥮", "谢谢大家帮忙", "生日红包", "新人红包", "加油！"];
    public static readonly string[] TransferNotes = ["上次的饭钱", "电影票", "AA 车费", "代购的东西", "生日礼物", "还你的", "咖啡钱", ""];
    public static readonly string[] GiftNotes = ["生日快乐🎂", "谢谢你一直以来的照顾", "加油！", "今天也要开心哦", "上次的咖啡我请啦", "送你一朵花🌹", "节日快乐", "", "", ""];

    // ------------------------------------------------------------------ live
    public static readonly string[] LiveTitles =
    [
        "今晚陪你聊聊天☕", "下班后的吉他时间🎸", "{city}夜市吃播", "学马来语第{n}课", "周末旅行分享：{place}", "深夜电台｜聊聊心事", "唱几首老歌给你听",
        "粤语歌之夜", "打工人的放松时间", "一起看{city}的夜景", "边煮饭边聊天", "新人主播，求关注🙏", "英文口语练习室", "今天聊聊怎么省钱", "猫咪陪你聊天🐱",
        "健身打卡直播", "化妆教程｜日常通勤妆", "周末早晨咖啡时光", "聊聊在大马的生活", "晚安前的小故事",
        "{city}下雨天，陪你听歌🌧️", "尤克里里弹唱｜点歌请留言", "今晚聊聊求职面试", "新手烘焙：班兰蛋糕", "夜猫子电台📻", "陪你学福建话",
        "中秋过后的月亮还是很圆🌕", "一起背单词｜IELTS 冲刺", "吃货在{city}：宵夜推荐", "瑜伽拉伸 20 分钟", "粤语老歌点唱机", "周二不加班，聊聊天",
        "Borak-borak santai malam ini", "Chill night, good music 🎧", "手作饰品直播", "聊聊养猫那些事", "马来西亚旅游攻略：{place}",
    ];
    public static readonly string[] LiveComments =
    [
        "来了来了", "主播晚上好", "哈哈哈哈", "这首歌好好听", "{city}的朋友报到", "点一首粤语老歌", "今天好漂亮", "声音好好听", "刚下班，来听你唱歌",
        "主播吃饭了吗", "666", "支持支持", "第一次来，关注了", "好可爱", "这里是{city}", "明天几点开播？", "晚安～", "再来一首！", "笑死我了", "哇～",
        "Hello from {cityEn}", "Sedap!", "加油加油", "主播好厉害", "声音好治愈",
    ];
    public static readonly string[] HostLines = ["欢迎新来的朋友～", "谢谢大家的礼物！", "今天先唱到这里，明天见", "有什么想听的可以打在公屏", "点个关注不迷路哦", "喝口水先"];
    public static readonly string[] CallTopics = ["聊聊旅行", "学中文", "学英文", "情感倾诉", "唱歌陪伴", "美食推荐", "职场经验", "马来语练习"];
    public static readonly string[] HostIntros =
    [
        "每晚九点开播，喜欢唱歌和聊天。", "在{city}工作的上班族，下班陪你聊聊天。", "会一点吉他，欢迎点歌🎸", "英文、中文、马来语都可以聊。",
        "喜欢旅行，想听你的故事。", "声音温柔，适合睡前聊天。", "美食主播，带你吃遍{city}。",
        "护士下班后的聊天时间，作息规律，每周直播四晚。", "大学在读，主修音乐，想用直播练胆量，会钢琴和吉他。", "做了三年电台主持，普通话、粤语都可以。",
        "瑜伽教练，平时分享拉伸和健康饮食，也可以陪你聊生活。", "在{city}开小咖啡店，晚上关店后想和大家聊聊天。", "会说华语、英语和马来语，可以陪练口语。",
        "喜欢画画和手作，直播时一边画一边聊。", "白天上班，晚上十点后上线，想认识更多朋友。", "健身爱好者，分享训练日常，欢迎一起打卡。",
        "Hi, I'm a part-time tutor in {cityEn}. Happy to chat in English or Malay.", "Suka menyanyi dan berborak, jom sembang malam-malam.",
        "之前在酒店做前台，很会聊天，想试试做主播。", "美妆博主，擅长日常妆和新娘妆教程。", "爱看剧爱八卦，下班陪你吐槽一整天。",
        "旅行达人，去过 20 多个国家，想分享路上的故事。",
    ];
    public static readonly string[] HostRejectNotes =
    [
        "资料不完整，请补充清晰的个人照片", "介绍内容过于简单，请补充后重新申请", "头像与本人不符，请上传本人近照", "未满 18 岁，暂不能申请主播",
        "介绍中含有站外联系方式，请删除后重新提交", "照片模糊，请上传清晰正面照",
    ];
    public static readonly string[] HostSuspendNotes = ["多次违规，暂停主播资格", "直播中引导私下交易，暂停 30 天", "长时间未开播且多次爽约一对一通话，暂停接单"];
    public static readonly string[] CallLinesSelf = ["你好～", "今天过得怎样？", "哈哈真的吗", "你那边几点了？", "谢谢你陪我聊天", "下次再找你", "我刚下班"];
    public static readonly string[] CallLinesHost = ["你好呀，很高兴接到你的电话", "今天有点累，不过看到你很开心", "你想聊什么都可以", "哈哈哈你好搞笑", "谢谢你的礼物！", "早点休息哦"];

    // ------------------------------------------------------------------ tickets
    public static readonly Dictionary<string, string[]> ReportDetails = new()
    {
        ["harassment"] = ["一直发私信骚扰，拉黑了又换号来找", "在评论区辱骂别人", "说话很难听，让人不舒服"],
        ["inappropriate"] = ["发的照片不太合适", "动态内容含有不雅图片", "直播间有不当言论"],
        ["fake"] = ["头像是盗用别人的照片", "冒充客服要我转账", "资料明显是假的"],
        ["spam"] = ["一直发广告，叫人加外部群", "评论区刷兼职广告", "私信推销投资课程"],
        ["scam"] = ["说要合作投资，让我先转钱", "以代购为名收钱后失联", "要求我提供银行账号和验证码"],
        ["minor"] = ["看起来像是未成年人", "自己说还在读中学"],
        ["misc"] = ["请帮忙核查一下这个账号", "不确定是不是诈骗，麻烦看看"],
    };
    public static readonly Dictionary<string, string[]> FeedbackTexts = new()
    {
        ["idea"] = ["希望可以增加夜间配送时段", "建议订单页面可以直接联系骑手", "希望可以用 TNG 直接付款", "可以增加按距离排序的功能吗", "希望会员有生日优惠"],
        ["design"] = ["深色模式下有些字看不清", "首页图标有点多，找不到入口", "聊天页面的字体可以大一点吗"],
        ["service"] = ["客服回复很快，点赞", "上次的清洁阿姨很好，希望能指定同一位", "商家确认太慢了，希望改进"],
        ["bug"] = ["安卓版上传头像会闪退", "有时候收不到消息通知", "账单页面加载很慢", "切换英文后部分内容还是中文"],
        ["misc"] = ["请问可以开发票吗", "希望增加更多城市的服务", "请问怎么注销账号"],
    };
    public static readonly string[] FeedbackReplies = ["谢谢您的建议，我们已经记录并转给产品团队。", "感谢反馈，问题已在最新版本修复，请更新 App。", "谢谢您的支持！我们会继续努力。", "已转交相关同事跟进，有进展会第一时间通知您。"];
    public static readonly string[] ReportReplies = ["经核查，已对该账号作出处理，感谢您的举报。", "经核查未发现违规，如有新证据欢迎再次提交。", "已对相关内容进行隐藏处理。", "已警告对方，如再次发生将封禁账号。"];
    public static readonly (string Name, string Category, string Text)[] MerchantApps =
    [
        ("阿华家庭清洁", "clean", "团队 6 人，专做住家和办公室清洁，有 5 年经验。"), ("小叶花艺工作室", "flower", "手作花束和节日花篮，可当天配送{city}市区。"),
        ("好味椰浆饭", "food", "在{area}经营 8 年的椰浆饭档口，想开通外送。"), ("快修师傅", "repair", "冷气、水电、热水器维修，持证电工。"),
        ("晨光美甲", "beauty", "美甲美睫工作室，两位美甲师。"), ("顺风接送", "car", "7 人座 MPV，提供机场接送和包车。"), ("乐活生鲜", "market", "批发市场直送蔬果，希望上架 24H 超市。"),
        ("老街咖啡", "food", "传统炭烧咖啡和烤面包，家族老店。"), ("City Walk 城市导览", "guide", "中英马三语导览，熟悉{city}老街文化。"), ("旅途小铺", "travel", "代订酒店和一日游行程。"),
        ("安心搬家", "delivery", "小型搬家和跑腿服务，价格透明。"), ("甜心烘焙", "flower", "生日蛋糕和节日礼盒，支持定制。"),
        ("阿娣香料咖喱屋", "food", "印度家常咖喱和印度煎饼，在{area}开店 6 年，想做午餐外送。"), ("Mak Cik Kuih 娘惹糕", "food", "每天手工制作娘惹糕和椰丝球，接受节日订单。"),
        ("丰收果园直送", "market", "自家榴莲园和热带水果，产地直送{city}。"), ("好邻居杂货", "market", "社区杂货店，米油蛋奶齐全，可 2 小时送达。"),
        ("洁亮冷气服务", "repair", "冷气清洗、加雪种、安装，团队 4 人，有 SPAN 相关资质。"), ("万能水电工", "repair", "水喉、电源、热水器安装维修，24 小时紧急上门。"),
        ("Glow 美容工作室", "beauty", "护肤、面部护理和脱毛，两位持证美容师。"), ("剪爱理发", "beauty", "男士理发和染烫，可上门为长辈理发。"),
        ("星河接送", "car", "机场、高铁站接送，10 人座 Starex，可包车去云顶和马六甲。"), ("日日清家政", "clean", "钟点清洁和开荒清洁，阿姨都有工作准证。"),
        ("绿意除虫", "clean", "白蚁、蟑螂、蚊虫防治，服务公寓和排屋。"), ("爱宠美容到家", "beauty", "上门宠物美容和洗澡，适合猫狗。"),
        ("Borneo 旅游工作室", "travel", "沙巴、砂拉越小团游和潜水行程。"), ("环球签证顾问", "visa", "MM2H、工作准证和学生签证咨询，前移民局文员。"),
        ("快跑腿同城", "delivery", "文件、钥匙、小件同城 90 分钟送达。"), ("满月礼盒坊", "flower", "满月礼盒、鸡蛋糕和红龟粿，可印名字。"),
        ("老城区导览", "guide", "带你走{city}老街和壁画，讲本地历史故事。"), ("学车陪练", "guide", "有驾照新手陪练和路线熟悉，教练经验 10 年。"),
        ("花时间花店", "flower", "进口鲜花和永生花，婚礼和开张花篮。"), ("快捷话费站", "phone", "代充各家电讯预付卡，也可以办理后付配套。"),
    ];
    public static readonly Dictionary<string, string[]> AfterSalesTexts = new()
    {
        ["reschedule"] = ["临时有事，想改到下周同一时间", "可以改到明天下午吗？", "师傅说今天来不了，能不能改周六上午", "家里有人生病，想延后三天"],
        ["refund"] = ["商家说缺货，希望退款", "重复下单了，申请退一单的钱", "服务没有完成，申请部分退款", "等了两个小时都没有人来，申请退款", "师傅只做了一半就走了"],
        ["quality"] = ["送来的水果有几个是坏的", "清洁不彻底，厨房还是很油", "蛋糕形状和图片差很多", "冷气修好第二天又漏水了", "花束和照片上的颜色不一样，有几朵已经蔫了", "外送到的时候汤洒了一半"],
        ["missing"] = ["少送了一份饮料", "订单里的鸡蛋没有送到", "少了一包米", "少了两瓶豆奶", "买了三份椰浆饭只收到两份"],
        ["misc"] = ["想咨询一下发票的问题", "师傅态度不太好", "骑手要求额外付停车费，这个合理吗？", "想换一位阿姨，之前那位不太准时"],
    };
    public static readonly string[] AfterSalesReplies = ["已与商家核实，差额已退回您的钱包。", "已帮您联系商家改期，新的时间已确认。", "非常抱歉，已安排商家补发。", "已记录并提醒商家改进服务。"];
    public static readonly string[] RejectReasons = ["收款账户姓名与实名不符", "账户信息有误，请核对后重新提交", "近期账户存在异常交易，请联系客服"];
    public static readonly string[] TopupRejectReasons = ["未查到到账记录，请确认转账是否成功", "转账金额与申请金额不符", "凭证不清晰，请重新上传"];

    public static readonly string[] Banks = ["Maybank", "CIMB Bank", "Public Bank", "RHB Bank", "Hong Leong Bank", "AmBank", "UOB Malaysia", "OCBC Bank", "Bank Islam", "Alliance Bank"];
    public static readonly string[] EWallets = ["Touch 'n Go eWallet", "DuitNow", "Boost", "GrabPay", "ShopeePay"];

    public static readonly string[] AgentCompanies = ["吉隆坡", "八打灵", "槟城", "新山", "马六甲", "怡保"];

    // ------------------------------------------------------------------ helpers
    public static string Fill(string template, Random r, City city, Area? area = null)
    {
        var s = template;
        if (s.Contains("{city}")) s = s.Replace("{city}", city.Zh);
        if (s.Contains("{cityEn}")) s = s.Replace("{cityEn}", city.En);
        if (s.Contains("{area}")) s = s.Replace("{area}", (area ?? city.Areas[r.Next(city.Areas.Length)]).Zh);
        if (s.Contains("{place}")) s = s.Replace("{place}", city.Places[r.Next(city.Places.Length)]);
        if (s.Contains("{food}")) s = s.Replace("{food}", Foods[r.Next(Foods.Length)]);
        if (s.Contains("{n}")) s = s.Replace("{n}", (r.Next(3, 40)).ToString());
        return s;
    }
}

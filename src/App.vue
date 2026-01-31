<script setup lang="ts">
import { reactive, computed, onMounted, ref } from 'vue';
import * as Tone from 'tone';
import shopItemsData from './data/shop_items.json';

const SAVE_KEY = 'sedori_guardian_save_v1';

// --- 型定義 ---
type ItemType = 'merch' | 'bag' | 'vehicle';
type ShopType = 'hardoff' | 'clothing' | 'pawn' | 'bike' | 'bagshop';
type CustomerType = 'normal' | 'maniac' | 'kid' | 'reseller' | 'bot';
type Location = 'home' | 'town' | 'store' | 'mercari_prep' | 'mercari' | 'bookstore' | 'labor' | 'ending' | 'temple';
type ShippingType = 'anonymous' | 'fast' | 'hand';

interface ShopItemDef {
  name: string;
  category: string;
  minPrice: number;
  maxPrice: number;
}
type ShopData = Record<string, ShopItemDef[]>;

interface Item {
  id: number;
  name: string;
  shopType: string;
  category: string;
  buyPrice: number;
  basePrice: number; // 真の価値（基準）
  realSellPrice: number; // 実際の売値（鑑定結果や市場価値）
  isResearched: boolean;
  researchedStatus: string;
  isCursed: boolean;
  isFake: boolean; // 偽物フラグ (Hard Modeのみ)
  itemType: ItemType;
  effectValue: number;
  description: string;
}

// --- ゲーム状態 ---
const getInitialState = () => ({
  isStarted: false,
  isGameOver: false,
  gameClear: false,
  difficulty: 'normal' as 'normal' | 'hard',
  location: 'home' as Location,
  
  // ステータス (初期資金5000)
  mp: 5000, 
  hp: 50,
  maxHp: 50,
  
  humanity: 100,
  mental: 100,
  alertLevel: 0,
  
  // 経験値・レベル
  laborLevel: 1,
  laborExp: 0,
  knowledgeLevel: 1, 
  knowledgeExp: 0,
  
  // インベントリ・装備
  inventory: [] as Item[],
  equippedBag: { 
    id: 0, name: "ポケット", itemType: 'bag', effectValue: 2, 
    description: "ポケットのみ。2個が限界。", buyPrice: 0, 
    shopType: '', category: '', realSellPrice: 0, basePrice: 0, isResearched: true, researchedStatus: '', isCursed: false, isFake: false
  } as Item,
  equippedVehicle: { 
    id: 0, name: "徒歩", itemType: 'vehicle', effectValue: 0, 
    description: "自分の足。移動に200分かかる。", buyPrice: 0,
    shopType: '', category: '', realSellPrice: 0, basePrice: 0, isResearched: true, researchedStatus: '', isCursed: false, isFake: false
  } as Item,

  // 時間・カレンダー
  day: 1,
  maxDays: 10,
  totalMinutes: 480, // 08:00 start
  
  // トレンド情報
  dailyTrendCategory: 'ジャンク',
  shopTrends: {} as Record<string, string>,
  isTrendKnown: false,
  magazineRemainingDays: 0,
  
  // 店舗用
  currentShopType: 'hardoff' as ShopType,
  currentShopName: 'ハードオフ',
  currentShopItem: null as Item | null,
  
  // メルカリ用
  negotiatingItem: null as Item | null,
  selectedShipping: 'anonymous' as ShippingType,
  customerType: 'normal' as CustomerType,
  customerComment: "",
  customerOfferPrice: 0,
  canNegotiate: true,
  
  // UI
  message: "「10日間で這い上がれ」",
  inventoryTab: 'all' as 'all' | 'equipment' | 'unresearched' | 'researched',
  hasSaveData: false,
  showManual: false,
  
  // イベントモーダル
  showPoliceModal: false,
  policeMessage: "",
  showCurseModal: false,
  curseMessage: "",
  showGlitch: false
});

const state = reactive(getInitialState());

const saveGame = () => {
  if (state.isGameOver || state.gameClear) return; // クリア・ゲームオーバー時は保存しない（または別途対応）
  const data = JSON.stringify(state);
  localStorage.setItem(SAVE_KEY, data);
  state.hasSaveData = true;
};

const loadGame = () => {
  const data = localStorage.getItem(SAVE_KEY);
  if (data) {
    const parsed = JSON.parse(data);
    Object.assign(state, parsed);
    state.hasSaveData = true;
    addLog("データロード完了。");
  }
};

const deleteSaveData = () => {
  if (confirm("本当にセーブデータを削除しますか？")) {
    localStorage.removeItem(SAVE_KEY);
    state.hasSaveData = false;
    // 状態リセット
    Object.assign(state, getInitialState());
    addLog("セーブデータを削除しました。");
  }
};

const savedDayDisplay = ref(1);

onMounted(() => {
  const data = localStorage.getItem(SAVE_KEY);
  if (data) {
    state.hasSaveData = true;
    try {
      const parsed = JSON.parse(data);
      if (parsed.day) {
        savedDayDisplay.value = Math.floor(parsed.day);
      }
    } catch (e) {
      console.error("Save data parse error", e);
    }
  }
});

// --- 計算プロパティ ---
const weekDays = ["にち", "げつ", "か", "すい", "もく", "きん", "ど"];
const currentDayOfWeek = computed(() => weekDays[state.day % 7]);
const isSaleDay = computed(() => state.day % 7 === 0 || state.day % 7 === 6);
const nextKnowledgeExp = computed(() => state.knowledgeLevel * 50);

const displayTime = computed(() => {
  const h = Math.floor(state.totalMinutes / 60);
  const m = state.totalMinutes % 60;
  return `${h}:${m.toString().padStart(2, '0')}`;
});

// 移動コスト
const moveCost = computed(() => {
  const base = 200; 
  return Math.max(30, base - state.equippedVehicle.effectValue);
});

const maxInventory = computed(() => state.equippedBag.effectValue);

// フィルタリング（テンプレートで使用するために修正）
const filteredInventory = computed(() => {
  if (state.inventoryTab === 'equipment') return state.inventory.filter(i => i.itemType !== 'merch');
  if (state.inventoryTab === 'unresearched') return state.inventory.filter(i => i.itemType === 'merch' && !i.isResearched);
  if (state.inventoryTab === 'researched') return state.inventory.filter(i => i.itemType === 'merch' && i.isResearched);
  return state.inventory.filter(i => i.itemType === 'merch'); // all
});

// 寺で表示する「呪われたアイテム」のみのリスト
const cursedInventory = computed(() => {
  return state.inventory.filter(i => i.isCursed);
});

// --- サウンド ---
let amSynth: Tone.AMSynth | null = null;
let noiseSynth: Tone.NoiseSynth | null = null;
let metalSynth: Tone.MetalSynth | null = null;

const triggerGlitch = () => {
  state.showGlitch = true;
  setTimeout(() => state.showGlitch = false, 500);
};

const initAudio = async () => {
  await Tone.start();
  amSynth = new Tone.AMSynth().toDestination();
  noiseSynth = new Tone.NoiseSynth({ noise: { type: 'brown' } }).toDestination();
  metalSynth = new Tone.MetalSynth().toDestination();
  if (!state.isStarted) {
    state.isStarted = true;
    decideTrend();
  }
};

const playSE = (type: string) => {
  try {
    if (type === 'buy') amSynth?.triggerAttackRelease("C6", "16n");
    if (type === 'error') amSynth?.triggerAttackRelease("G2", "8n");
    if (type === 'search') noiseSynth?.triggerAttackRelease("16n");
    if (type === 'cash') amSynth?.triggerAttackRelease("E6", "8n");
    if (type === 'work') metalSynth?.triggerAttackRelease("32n", "16n");
    if (type === 'curse') noiseSynth?.triggerAttackRelease("1n");
    if (type === 'police') { noiseSynth?.triggerAttackRelease("8n"); metalSynth?.triggerAttackRelease("G2", "16n"); }
    if (type === 'equip') amSynth?.triggerAttackRelease("G4", "8n");
    if (type === 'bell') metalSynth?.triggerAttackRelease("C5", "4n");
    if (type === 'negotiate') amSynth?.triggerAttackRelease("C4", "32n");
  } catch (e) {
    console.warn("Audio Error", e);
  }
};

// --- ロジック: 時間経過とイベント ---
const addLog = (msg: string) => state.message = msg;

const checkGameOver = () => {
  if (state.mp < -2000) return "借金地獄で破産"; // 借金許容額
  if (state.hp <= 0) return "過労死… 肉体の限界を超えてしまった。";
  if (state.humanity <= 0) return "人間性を完全に喪失し、逮捕された";
  if (state.mental <= 0) return "精神が崩壊し、病院へ収容された";
  return null;
};

const decideTrend = () => {
  const allCats = ['ジャンク', '中古家電', 'ゲーム', 'オーディオ', 'カメラ', '楽器', '古着', 'スニーカー', 'ブランド', '時計', '貴金属'];
  
  // 店舗ごとのカテゴリ定義（JSONと同期させる）
  const shopCats: Record<string, string[]> = {
    hardoff: ['ジャンク', '中古家電', 'ゲーム', 'オーディオ', 'カメラ', '楽器'],
    clothing: ['古着', 'スニーカー', 'ブランド'],
    pawn: ['時計', 'ブランド', '貴金属'],
    bike: ['バイクパーツ'],
    bagshop: ['バッグ']
  };

  state.dailyTrendCategory = allCats[Math.floor(Math.random() * allCats.length)];
  
  state.shopTrends = {};
  ['hardoff', 'clothing', 'pawn'].forEach(k => {
    const cats = shopCats[k];
    if (cats && cats.length > 0) {
       state.shopTrends[k] = cats[Math.floor(Math.random() * cats.length)];
    }
  });

  if (state.magazineRemainingDays > 0) {
    state.isTrendKnown = true;
    addLog(`（雑誌効果：本日のトレンド「${state.dailyTrendCategory}」）`);
  } else {
    state.isTrendKnown = false;
  }
};

const timePass = (minutes: number) => {
  state.totalMinutes += minutes;
  
  const failReason = checkGameOver();
  if (failReason) {
    state.message = failReason;
    state.isGameOver = true;
    localStorage.removeItem(SAVE_KEY); // ゲームオーバーでデータ消去
    return;
  }

  // 22:00 (1320分) で強制帰宅
  if (state.totalMinutes >= 1320) {
    state.totalMinutes = 480; 
    state.day++;
    state.location = 'home';
    
    if (state.day > state.maxDays) {
      triggerEnding();
      // クリア時にセーブデータを消す（周回要素未実装のため）
      localStorage.removeItem(SAVE_KEY);
      return;
    }

    // オートセーブ
    saveGame();
    addLog(`【Day${state.day}開始】オートセーブ完了。`);

    // Hard Mode: ランダムイベント
    if (state.difficulty === 'hard') {
      triggerRandomEvent();
    }

    const recover = Math.floor(state.maxHp * 0.7);
    state.hp = Math.min(state.maxHp, state.hp + recover);
    
    if (state.magazineRemainingDays > 0) {
      state.magazineRemainingDays--;
      if (state.magazineRemainingDays === 0) {
        state.isTrendKnown = false;
        addLog("雑誌の有効期限が切れた。");
      }
    }

    if (state.alertLevel > 0) {
      const raidChance = state.alertLevel * 0.20; 
      if (Math.random() < raidChance) {
        policeRaid();
      } else {
        state.alertLevel = Math.max(0, state.alertLevel - 1);
        addLog(`ーー ${state.day}日目。サイレンの音で目が覚めた。 ーー`);
      }
    } else {
      addLog(`ーー ${state.day}日目。生き残れ。 ーー`);
    }

    if (state.day % 7 === 0) payInternetBill();
    
    decideTrend();
  }
};

const policeRaid = () => {
  playSE('police');
  addLog("【ガサ入れ】「警察だ！転売容疑で家宅捜索を行う！」");
  
  const cursedItems = state.inventory.filter(i => i.isCursed);
  let confiscatedCount = 0;
  
  if (cursedItems.length > 0) confiscatedCount += cursedItems.length;
  
  const normalItems = state.inventory.filter(i => !i.isCursed && i.itemType === 'merch');
  const keptItems: Item[] = [];
  normalItems.forEach(item => {
    if (Math.random() < 0.2) confiscatedCount++; 
    else keptItems.push(item);
  });
  
  const equipments = state.inventory.filter(i => i.itemType !== 'merch');
  state.inventory = [...equipments, ...keptItems];

  if (confiscatedCount > 0) {
    state.mental -= 40;
    state.humanity -= 20;
    state.alertLevel = Math.max(0, state.alertLevel - 5);
    state.policeMessage = `「怪しい品を押収する！しばらく大人しくしているんだな！」\n\n【被害報告】\n没収アイテム数: ${confiscatedCount}\nメンタル: -40\n人間性: -20`;
    addLog(`【ガサ入れ】アイテム${confiscatedCount}個没収。メンタル-40, 人間性-20`);
  } else {
    state.mental -= 15;
    state.alertLevel = Math.max(0, state.alertLevel - 2);
    state.policeMessage = `「今回は見逃してやるが、監視は強化するぞ」\n\n【被害報告】\n没収なし\nメンタル: -15`;
    addLog("【ガサ入れ】没収なし。メンタル-15");
  }
  state.showPoliceModal = true;
};

const triggerRandomEvent = () => {
  const rand = Math.random();
  // 30%の確率でイベント発生
  if (rand < 0.15) {
    // SNS炎上
    state.mental = Math.min(100, state.mental + 20);
    state.alertLevel += 1;
    addLog("【SNS炎上】愚痴ポストがバズった！承認欲求は満たされたが、警察の目も…(メンタル+20 / 警戒+1)");
  } else if (rand < 0.30) {
    // 同業者の密告
    state.alertLevel += 2;
    addLog("【密告】「あいつは違法転売をしている」同業者に通報されたようだ…(警戒+2)");
  }
};

const payInternetBill = () => {
  const BILL = 6000;
  state.mp -= BILL; 
  playSE('cash');
  addLog(`通信費 ￥${BILL} 引き落とし。残高:￥${state.mp}`);
  if (state.mp < -2000) {
    state.isGameOver = true;
    state.message = "通信費未払いによりネット停止。THE END";
    localStorage.removeItem(SAVE_KEY); // ゲームオーバーでデータ消去
  }
};

// --- アイテム生成ロジック ---
// shopDataDef was replaced by shop_items.json

const generateItem = (shopType: ShopType): Item => {
  // ■ カバン屋
  if (shopType === 'bagshop') {
    const tier = Math.random();
    if (tier > 0.6) {
      return {
        id: Date.now(), name: "登山家リュック", shopType, category: "装備",
        buyPrice: 15000, basePrice: 4000, realSellPrice: 4000,
        isResearched: true, researchedStatus: "装備品", isCursed: false, isFake: false,
        itemType: 'bag', effectValue: 12, description: "容量12。プロの道具。"
      };
    } else {
      return {
        id: Date.now(), name: "学生カバン", shopType, category: "装備",
        buyPrice: 5000, basePrice: 1000, realSellPrice: 1000,
        isResearched: true, researchedStatus: "装備品", isCursed: false, isFake: false,
        itemType: 'bag', effectValue: 6, description: "容量6。最低限の装備。"
      };
    }
  }

  // ■ バイク屋
  if (shopType === 'bike') {
    const tier = Math.random(); 
    if (tier > 0.7) {
       return {
        id: Date.now(), name: "原付バイク", shopType, category: "装備",
        buyPrice: 80000, basePrice: 20000, realSellPrice: 20000,
        isResearched: true, researchedStatus: "装備品", isCursed: false, isFake: false,
        itemType: 'vehicle', effectValue: 150, description: "移動-150分。行動範囲が広がる。"
      };
    } else if (tier > 0.3) {
      return {
        id: Date.now(), name: "クロスバイク", shopType, category: "装備",
        buyPrice: 30000, basePrice: 8000, realSellPrice: 8000,
        isResearched: true, researchedStatus: "装備品", isCursed: false, isFake: false,
        itemType: 'vehicle', effectValue: 100, description: "移動-100分。風になれる。"
      };
    } else {
      return {
        id: Date.now(), name: "ママチャリ", shopType, category: "装備",
        buyPrice: 10000, basePrice: 2000, realSellPrice: 2000,
        isResearched: true, researchedStatus: "装備品", isCursed: false, isFake: false,
        itemType: 'vehicle', effectValue: 60, description: "移動-60分。徒歩よりマシ。"
      };
    }
  }

  // ■ 通常アイテム (JSONデータ使用・Type safe)
  const shopDataFull = shopItemsData as ShopData;
  const shopData = shopDataFull[shopType];
  
  if (!shopData) {
      return {
          id: Date.now(), name: "謎の物体", shopType, category: "不明",
          buyPrice: 100, basePrice: 100, realSellPrice: 100,
          isResearched: false, researchedStatus: "???", isCursed: false, isFake: false,
          itemType: 'merch', effectValue: 0, description: "データエラー"
      };
  }

  const itemDef = shopData[Math.floor(Math.random() * shopData.length)];
  const category = itemDef.category;
  const itemName = itemDef.name;
  
  const minP = itemDef.minPrice;
  const maxP = itemDef.maxPrice;
  let basePrice = Math.floor(Math.random() * (maxP - minP)) + minP;
  
  let buy = basePrice;
  if (isSaleDay.value && shopType === 'hardoff') buy = Math.floor(buy * 0.7); 

  const sameCat = state.inventory.filter(i => i.category === category).length;
  if (sameCat > 0) buy = Math.floor(buy * (1 + sameCat * 0.20)); 

  const isTrend = category === state.dailyTrendCategory;
  const isShopRec = category === state.shopTrends[shopType];
  
  let variance = shopType === 'pawn' ? 0.8 : 0.5; 
  let mult = Math.random() * (1 + variance) + (1 - variance/2); 
  
  if (isTrend) mult += 2.0; 
  if (isShopRec) mult += 0.5;

  // 偽物判定 (Hard Modeのみ: 10%の確率で偽物)
  const isFake = state.difficulty === 'hard' && Math.random() < 0.10;
  
  // 偽物の場合、真の価値は激安だが、見た目の価値(basePrice)は維持される
  // 鑑定時に realSellPrice が暴かれる
  const realVal = Math.floor(basePrice * mult);

  return {
    id: Date.now() + Math.random(),
    name: itemName,
    shopType, category,
    buyPrice: buy, basePrice: realVal, realSellPrice: realVal, // 未鑑定段階ではrealSellPriceも高く見える
    isResearched: false, researchedStatus: "???",
    isCursed: Math.random() > 0.92, 
    isFake: isFake,
    itemType: 'merch', effectValue: 0, description: "売却用アイテム"
  };
};

// --- アクション ---

const goToStore = (type: ShopType, name: string) => {
  state.currentShopType = type;
  state.currentShopName = name;
  state.location = 'store';
  state.currentShopItem = generateItem(type);
  addLog(`${name}へ到着。移動でクタクタだ…`);
  timePass(moveCost.value);
};

const buy = () => {
  if (!state.currentShopItem) return;
  if (state.inventory.length >= maxInventory.value) return addLog("くそっ、カバンがパンパンだ。");
  if (state.mp < state.currentShopItem.buyPrice) return addLog("金が足りない…！");

  if (Math.random() < 0.20) {
      state.mental -= 5;
      playSE('error');
      addLog("店員が舌打ちをした。「チッ、転売ヤーかよ…」 (メンタル-5)");
  }

  state.mp -= state.currentShopItem.buyPrice;
  const newItem = { ...state.currentShopItem, id: Date.now() + Math.random() };
  state.inventory.push(newItem);
  
  if (state.currentShopItem.isCursed) {
    triggerGlitch(); // グリッチ演出
    playSE('curse');
    state.mental -= 20;
    state.curseMessage = `「…そのアイテムからは不吉な気配がする…」\n手に入れた瞬間、寒気が走った！(メンタル-20)`;
    addLog("【呪い】不吉な予感がする…(メンタル-20)");
    state.showCurseModal = true;
  } else {
    playSE('buy');
    addLog(`${state.currentShopItem.name}を仕入れた。(残￥${state.mp})`);
  }
  
  state.currentShopItem = generateItem(state.currentShopType);
};

const equipItem = (item: Item) => {
  if (item.itemType === 'bag') {
    if (state.inventory.length > item.effectValue) {
      return addLog(`荷物が多すぎて入りきらない！先に整理しろ。`);
    }
    const old = { ...state.equippedBag, isResearched: true, researchedStatus: "中古", id: Date.now() };
    if (old.name !== "ポケット") state.inventory.push(old);
    state.equippedBag = item;
    addLog(`【装備】${item.name}に持ち替えた！`);
  } 
  else if (item.itemType === 'vehicle') {
    const old = { ...state.equippedVehicle, isResearched: true, researchedStatus: "中古", id: Date.now() };
    if (old.name !== "徒歩") state.inventory.push(old);
    state.equippedVehicle = item;
    addLog(`【装備】${item.name}に乗車！`);
  }
  state.inventory = state.inventory.filter(i => i.id !== item.id);
  playSE('equip');
};

const doDayLabor = (level: 'light' | 'normal' | 'hard') => {
  let hpCost = 0;
  let wage = 0;
  let exp = 0;

  const isAccident = Math.random() < 0.15; 

  if (level === 'light') {
    if (state.hp < 15) return addLog("体力が足りない。(必要HP15)");
    hpCost = 15; wage = 1500; exp = 10;
    addLog("チラシ配りをした。(￥1500)");
  } else if (level === 'normal') {
    if (state.hp < 30) return addLog("体力が足りない。(必要HP30)");
    hpCost = 30; wage = 2500 + (state.laborLevel * 200); exp = 20; 
    addLog("引っ越し作業。(￥" + wage + ")");
  } else if (level === 'hard') {
    if (state.laborLevel < 3) return addLog("ベテランしか入れない。(Lv3必要)");
    if (state.hp < 50) return addLog("今の体力では死ぬぞ。(必要HP50)");
    hpCost = 50; wage = 7000; exp = 30; // EXP減・HP消費増
    addLog("産業廃棄物処理。(￥7000)");
  }

  if (isAccident) {
    const accidentType = Math.random();
    if (accidentType < 0.5) {
      hpCost += 10;
      wage = Math.floor(wage * 0.8);
      addLog("【軽作業ミス】少し怪我をした。治療費が痛い。(HP-10, 給料2割減)");
    } else {
      hpCost += 30;
      wage = 0;
      addLog("【労働災害】大怪我をして担架で運ばれた！給料はナシだ！(HP-30, 給料全没収)");
    }
  }

  state.hp -= hpCost;
  state.mp += wage;
  state.laborExp += exp;
  playSE('work');
  
  // レベルアップ難易度上昇 (Lv * 150)
  if (state.laborExp >= state.laborLevel * 150) {
    state.laborLevel++;
    state.maxHp += 2; // 最大HP上昇微減
    state.hp = Math.min(state.maxHp, state.hp + 20); // 全回復廃止
    addLog(`【肉体強化】Lv${state.laborLevel}になった。(最大HP+2, HP+20)`);
  }
  timePass(240); 
};

// ネット検索 (鑑定眼スキル実装)
const googleItem = (item: Item) => {
  if (state.mental < 5) return addLog("頭が働かない…");
  item.isResearched = true;
  state.mental -= 5;
  
  // 鑑定成功率: Lv1=60%, Lv10=96%
  const accuracy = 0.6 + (state.knowledgeLevel * 0.04);
  const isSuccess = Math.random() < accuracy;

  playSE('search');

  if (item.isFake) {
    if (isSuccess) {
      // 見破った
      triggerGlitch(); // グリッチ演出
      item.researchedStatus = "偽物(Junk)";
      item.realSellPrice = Math.floor(item.buyPrice * 0.1); // 二束三文
      item.name = "偽の" + item.name;
      addLog(`【鑑定成功】危ない！これは精巧な偽物だ！(価値暴落)`);
    } else {
      // 騙された（本物だと思いこむ）
      item.researchedStatus = "超お宝!?";
      // realSellPriceは高いまま維持されるが、売却時にバレるリスクがある
      addLog(`【検索終了】これはすごい値がつきそうだ！(${Math.floor(accuracy*100)}%確信)`);
    }
  } else {
    // 本物の場合
    item.researchedStatus = "相場済";
    addLog(`【検索終了】相場確認完了。`);
  }
  timePass(15);
};

// --- メルカリ ---
const openMercariPrep = (item: Item) => {
  state.negotiatingItem = item;
  state.location = 'mercari_prep';
  state.selectedShipping = 'anonymous'; 
};

const confirmListing = () => {
  if (!state.negotiatingItem) return;
  state.location = 'mercari';
  state.canNegotiate = true;

  const item = state.negotiatingItem;
  const r = Math.random();

  // S2. 配送方法が客層を厳密に決める
  if (state.selectedShipping === 'fast') {
    // 速達: マニア(60%) or 転売ヤー(40%)
    state.customerType = r < 0.6 ? 'maniac' : 'reseller';
  } else if (state.selectedShipping === 'hand') {
    // 手渡し: キッズ(80%) or 一般(20%)
    state.customerType = r < 0.8 ? 'kid' : 'normal';
  } else {
    // 匿名: 一般(60%) or 転売ヤー(30%) or マニア(10%)
    if (r < 0.6) state.customerType = 'normal';
    else if (r < 0.9) state.customerType = 'reseller';
    else state.customerType = 'maniac';
  }
  
  // 呪物は強制的に変な客を呼ぶことがある
  if (item.isCursed && Math.random() < 0.5) {
     state.customerType = 'maniac'; 
  }

  calcOffer();
  addLog("出品完了。ターゲット通りの客は来るか…？");
};

const calcOffer = () => {
  if (!state.negotiatingItem) return;
  const item = state.negotiatingItem;
  let base = item.realSellPrice;
  
  if (state.customerType === 'maniac') base *= 2.5; 
  if (state.customerType === 'kid') base *= 0.4;   
  if (state.customerType === 'reseller') base *= 0.7; 
  if (state.customerType === 'normal') base *= (0.8 + Math.random() * 0.4);

  state.customerOfferPrice = Math.floor(base);
  state.customerComment = getComment(state.customerType);
}

const getComment = (type: CustomerType) => {
  if (type === 'maniac') return "「ハァハァ…その汚れ…タマりません！言い値で買います！」";
  if (type === 'kid') return "「ぼくのおこづかい、これしかないの。おねがい！（泣）」";
  if (type === 'reseller') return "「相場より少し高いですが即決します。専用お願いします。」";
  return "「購入希望です。お値下げ可能でしょうか？」";
};

const negotiateOneShot = () => {
  if (!state.canNegotiate) return;
  state.canNegotiate = false;

  const successRate = 0.3 + (state.knowledgeLevel * 0.05);
  
  if (Math.random() < successRate) {
    playSE('negotiate');
    // S5. 交渉システムを単価上昇型に変更 (Lv依存)
    const increaseRate = 0.1 + (state.knowledgeLevel * 0.02); // Lv1=12%, Lv10=30%, Lv20=50%
    state.customerOfferPrice = Math.floor(state.customerOfferPrice * (1 + increaseRate));
    addLog(`「くっ…話がうまいな。それで買おう！」(価格+${Math.floor(increaseRate*100)}%)`);
  } else {
    playSE('error');
    addLog("「ふざけんな！他を当たるわ！」(交渉決裂・取引中止)");
    finishDeal(false);
  }
  timePass(10);
};

const finishDeal = (accept: boolean) => {
  if (accept && state.negotiatingItem) { // 取引成立
    let finalPrice = state.customerOfferPrice;
    
    // 偽物バレ（Hardモード かつ 偽物未発覚の場合）
    if (state.negotiatingItem?.isFake && state.negotiatingItem.researchedStatus !== "偽物(Junk)") {
      // 80%の確率でバレる
      if (Math.random() < 0.8) {
        triggerGlitch();
        addLog("【取引中止】「おい！これ偽物じゃねーか！」客が激怒して帰ってしまった…(信用失墜)");
        state.mental -= 30;
        state.humanity -= 30; // 人間性大幅ダウン
        state.location = 'home';
        state.negotiatingItem = null;
        playSE('error');
        // アイテムは返品される（手元に残る）
        return;
      } else {
        addLog("【取引成功】(客は偽物だと気づいていないようだ…罪悪感で胸が痛む)");
        state.humanity -= 15; // バレなくても人間性は減る
      }
    }

    state.mp += finalPrice;
    addLog(`売却成功！ ￥${finalPrice.toLocaleString()} を手に入れた。`);

    // 【修正】呪物売却時のペナルティ強化ロジック
    if (state.negotiatingItem.isCursed) {
       if (state.customerType === 'maniac') {
         state.humanity -= 10; // マニアに売っても下がる
         playSE('curse');
         addLog("マニアに呪物を引き渡した…罪悪感が残る。(人間性-10)");
       }
       else {
         state.humanity -= 30; // 一般人に売ると激減
         playSE('curse');
         addLog("罪なき人に呪物を送りつけた…人の心がないのか？(人間性-30)");
       }
    } else {
       if (state.customerType === 'kid') {
         state.humanity += 50;
         addLog("子供は笑顔で去っていった…心が洗われるようだ。(人間性+50)");
       } else {
         addLog(`売却成立！ ￥${state.customerOfferPrice} GET。`);
       }
    }
    
    state.inventory = state.inventory.filter(i => i.id !== state.negotiatingItem?.id);
    playSE('cash');
  } else {
    addLog("取引終了。");
  }
  state.location = 'home';
  state.negotiatingItem = null;
  timePass(30); 
};

// --- ネットで勉強 ---
const studyInternet = () => {
  state.location = 'home'; 
  state.knowledgeExp += 20;
  state.mental -= 5;
  playSE('search');
  addLog("相場情報を徹底的に調べた。(Exp+20)");
  checkKnowledgeUp();
  timePass(60); 
};

const checkKnowledgeUp = () => {
  if (state.knowledgeLevel < 20 && state.knowledgeExp >= state.knowledgeLevel * 50) {
    state.knowledgeLevel++;
    state.knowledgeExp = 0;
    addLog(`【知識LvUP】Lv${state.knowledgeLevel}！ 検索精度と交渉力が向上した！`);
  }
};

// --- 寺 ---
const visitTemple = () => {
  state.location = 'temple';
  addLog("寺に来た。線香の匂いがする。");
};

const prayAtTemple = () => {
  if (state.mp < 1000) return addLog("お布施が足りない。");
  state.mp -= 1000;
  state.mental = Math.min(100, state.mental + 40);
  state.humanity = Math.min(100, state.humanity + 15);
  state.alertLevel = Math.max(0, state.alertLevel - 2);
  playSE('bell');
  addLog("心が洗われ、警察のマークも薄まった気がする。(Alert低下)");
  timePass(60);
};

// 【修正】呪物浄化機能の不具合修正
const purifyItem = (targetItem: Item) => {
  if (state.mp < 3000) return addLog("祈祷料(￥3000)が足りない。");

  // 配列内のインデックスを特定して直接操作（リアクティビティを確実にする）
  const index = state.inventory.findIndex(i => i.id === targetItem.id);
  if (index === -1) return;

  state.mp -= 3000;
  
  // 状態の更新
  state.inventory[index].isCursed = false;
  state.inventory[index].researchedStatus = "浄化済(半値)";
  state.inventory[index].realSellPrice = Math.floor(state.inventory[index].basePrice * 0.5); // 浄化による価値低下

  state.mental += 10;
  playSE('bell');
  addLog(`${targetItem.name}の浄化完了。ただし価値は下がってしまった。(売値50%)`);
  timePass(60);
};

// --- エンディング ---
const endingData = reactive({ title: "", desc: "", score: 0 });
const triggerEnding = () => {
  state.gameClear = true;
  state.location = 'ending';
  
  // B7. スコア計算を「人間性>資産」に逆転
  const baseScore = (state.humanity * 500) + (state.mp * 0.1) + (state.mental * 100);
  endingData.score = Math.floor(baseScore);
  
  if (state.mp < 0) {
    endingData.title = "【破産: 地下帝国行き】";
    endingData.desc = "借金返済のため、知らない男たちに車に乗せられた。人間性がいくらあっても金がなければ生きていけない。";
  } else if (state.humanity >= 100 && state.mp > 500000) {
     endingData.title = "【伝説: せどり守護神】";
     endingData.desc = "清らかな心と圧倒的な財力。君はこの街の伝説となった。";
  } else if (state.humanity >= 80) {
    endingData.title = "【成功: 徳の高い商人】";
    endingData.desc = "多くの人を助けながら資産を築いた。街の人々から慕われている。";
  } else if (state.mp > 1000000) {
    endingData.title = "【怪異: 金の亡者】";
    endingData.desc = "圧倒的な金を手に入れたが、心は冷え切っている。孤独な富豪。";
  } else if (state.mp > 200000) {
    endingData.title = "【凡人: 小金持ち】";
    endingData.desc = "それなりに稼いだが、何か大切なものを置き忘れていないか？";
  } else {
    endingData.title = "【生存: ギリギリの生活】";
    endingData.desc = "なんとか10日間を生き延びた。明日も戦いは続く。";
  }
};

const buyMagazine = () => {
  if (state.mp < 1200) return addLog("金がない。(￥1200)");
  state.mp -= 1200; 
  state.magazineRemainingDays = 7;
  decideTrend();
  playSE('cash');
  addLog("週刊せどりウォーカー購入。7日間トレンドが見える！");
};

const reloadPage = () => {
    window.location.reload();
};


</script>

<template>
  <div v-if="!state.isStarted" class="start-screen">
    <h1>せどり守護神・改</h1>
    <p>～ 限界の10日間 ～</p>

    <div class="start-opts">
      <button v-if="state.hasSaveData" @click="loadGame(); initAudio();" class="resume-btn">
        つづきから (Day {{ savedDayDisplay }})
      </button>
      <button @click="state.difficulty='normal'; initAudio();" class="newgame-btn">
        🔰 通常モードではじめる
      </button>
      <button @click="state.difficulty='hard'; initAudio();" class="newgame-btn hard-mode">
        🔥 上級モードではじめる
      </button>
      <button @click.stop="state.showManual = true" class="manual-btn">
        📖 攻略マニュアル (更新)
      </button>
    </div>

    <div v-if="state.hasSaveData" class="data-manage">
       <button @click.stop="deleteSaveData" class="delete-btn">データ削除</button>
    </div>
  </div>

  <div v-if="state.showManual" class="manual-overlay">
    <div class="manual-content">
      <h2>【攻略の虎の巻】</h2>
      <p>やあ、迷える子羊くん。この過酷な10日間を生き抜くための知恵を授けよう。</p>

      <h3>1. 全ての基本は「知識Lv」だ</h3>
      <p>自宅で「ネット勉強」をサボるな。<strong>知識Lvが上がれば、交渉成功率が上がり、さらに売値も釣り上げられる。</strong><br>Lv1とLv10では世界が違うぞ。</p>

      <h3>2. 客層を見極めろ</h3>
      <p>出品時の配送方法で客が変わる。これを使いこなせ。</p>
      <ul>
        <li><strong>📦 匿名 (標準)</strong>: リスクとリターンのバランス型。</li>
        <li><strong>🚚 速達 (プロ向)</strong>: 「マニア」や「転売ヤー」が来る。金払いはいいが、要求もうるさい。</li>
        <li><strong>🤝 手渡し (地元)</strong>: 「キッズ」などが来る。金はないが、感謝され「人間性」が回復する。</li>
      </ul>

      <h3>3. 3つの死因（ゲームオーバー）</h3>
      <ul>
        <li><strong>HP 0</strong>: 過労死。日雇いは計画的に。</li>
        <li><strong>メンタル 0</strong>: 発狂。罵倒されたら寺で心を洗え。</li>
        <li><strong>人間性 0</strong>: 逮捕。キッズから搾取したり、呪物を売りつけると下がる。</li>
      </ul>

      <h3>4. 呪物のリスク</h3>
      <p>たまに手に入る「呪物」は高く売れるが、持っていると警察に没収されるリスクがある。<br>寺で「浄化」すれば安全だが、価値は半減する。<strong>売り逃げるか、清めるか。</strong>君の良心が試されるな。</p>

      <h3>5. 装備を整えろ</h3>
      <p>ポケットのままじゃ何も運べない。まずは「カバン屋」へ行け。<br>移動で一日が終わる？ 「バイク屋」で乗り物を買え。</p>

      <h3>6. 【上級モード】ここが地獄だ</h3>
      <p>上級モードでは以下の脅威が追加される。</p>
      <ul>
        <li><strong>偽物アイテム</strong>: ネット勉強(知識Lv)が低いと、偽物をつかまされる。偽物を売ると…わかるな？</li>
        <li><strong>SNS炎上</strong>: 承認欲求でメンタルは回復するが、目立ちすぎて警察のマークがきつくなる。</li>
        <li><strong>密告</strong>: 足を引っ張り合うのが底辺の常だ。突然警戒度が上がるぞ。</li>
      </ul>
      <p>生きて帰ってこい。</p>
    </div>
    <button class="manual-close" @click="state.showManual = false">閉じる</button>
  </div>

  <div v-if="state.showPoliceModal" class="police-overlay">
    <div class="police-alert">
      <h2>🚨 警察だ！ 🚨</h2>
      <div class="police-msg">{{ state.policeMessage }}</div>
      <button @click="state.showPoliceModal = false">了解</button>
    </div>
  </div>

  <div v-if="state.showCurseModal" class="curse-overlay">
    <div class="curse-alert">
      <h2>💀 呪われた！ 💀</h2>
      <div class="curse-msg">{{ state.curseMessage }}</div>
      <button @click="state.showCurseModal = false">震える</button>
    </div>
  </div>

  <div v-if="state.location === 'ending'" class="game-over-screen ending">
    <h1>{{ endingData.title }}</h1>
    <p>{{ endingData.desc }}</p>
    <div class="score-board">
      <p>最終資産: ￥{{ state.mp.toLocaleString() }}</p>
      <p>人間性: {{ state.humanity }} / メンタル: {{ state.mental }}</p>
      <h2>総合スコア: {{ endingData.score }}</h2>
    </div>
    <button @click="reloadPage">タイトルへ</button>
  </div>
  
  <div v-else-if="state.isGameOver" class="game-over-screen">
    <h1>GAME OVER</h1>
    <p class="fail-msg">{{ state.message }}</p>
    <button @click="reloadPage">再挑戦</button>
  </div>

  <div v-else-if="state.isStarted" class="game-container" :class="{ 'glitch-active': state.showGlitch }">
    <header>
      <div class="status-row">
        <span>Day{{ state.day }}/{{ state.maxDays }}({{ currentDayOfWeek }}) {{ displayTime }}</span>
        <span class="money" :class="{debt: state.mp < 0}">￥{{ state.mp.toLocaleString() }}</span>
      </div>
      <div class="equip-row">
        <span>👜:{{ state.equippedBag.name }}({{ state.inventory.length }}/{{ maxInventory }})</span>
        <span>🚲:{{ state.equippedVehicle.name }}</span>
      </div>
      <div class="status-row">
        <span>HP:{{ state.hp }}</span>
        <span :class="{critical: state.mental<30}">心:{{ state.mental }}</span>
        <span :class="{bad: state.humanity<30}">人:{{ state.humanity }}</span>
        <span :class="{alert: state.alertLevel>0}">警:{{ Math.floor(state.alertLevel) }}</span>
      </div>
    </header>

    <main>
      <div v-if="state.location === 'home'" class="scene">
        <div class="home-header">
           <h3>【 自宅兼倉庫 】</h3>
           <div class="menu-buttons">
             <button @click="state.location = 'town'">街へ出る(Cost:{{moveCost}}分)</button>
             <button @click="studyInternet">ネット勉強(Lv{{state.knowledgeLevel}})</button>
           </div>
           
           <div class="tips-box">
             <strong>【ネット勉強の効果】</strong><br>
             Lv{{state.knowledgeLevel}}特典: 交渉成功率 {{ 30 + state.knowledgeLevel*5 }}%
             <br>
             <span class="exp-bar">Next: {{ nextKnowledgeExp - state.knowledgeExp }} exp</span>
           </div>
        </div>

        <div class="inventory-box">
          <div class="tabs">
            <button :class="{active: state.inventoryTab==='all'}" @click="state.inventoryTab='all'">全</button>
            <button :class="{active: state.inventoryTab==='equipment'}" @click="state.inventoryTab='equipment'">装</button>
            <button :class="{active: state.inventoryTab==='unresearched'}" @click="state.inventoryTab='unresearched'">未</button>
            <button :class="{active: state.inventoryTab==='researched'}" @click="state.inventoryTab='researched'">済</button>
          </div>
          <p class="inv-count">容量: {{ state.inventory.length }}/{{ maxInventory }}</p>

          <ul>
            <li v-for="item in filteredInventory" :key="item.id" class="inv-item">
              <div class="inv-info">
                <span :class="{'cursed-text': item.isCursed}">{{ item.name }}</span>
                <span v-if="item.itemType === 'merch' && item.isResearched" class="price-reveal">
                  ￥{{ item.realSellPrice.toLocaleString() }}
                  <span class="badge">{{ item.researchedStatus }}</span>
                </span>
                <small v-if="item.itemType !== 'merch'" class="effect-text">{{ item.description }}</small>
              </div>
              <div class="inv-act">
                <template v-if="item.itemType === 'merch'">
                   <button v-if="!item.isResearched" @click="googleItem(item)">調査</button>
                   <button v-else @click="openMercariPrep(item)" class="sell-btn">売却</button>
                </template>
                  <template v-else>
                    <button @click="state.mp += Math.floor(item.buyPrice * 0.3); state.inventory = state.inventory.filter(i => i.id !== item.id); addLog(`${item.name}を処分した(￥${Math.floor(item.buyPrice * 0.3)})`); playSE('cash');" class="sell-btn">売却</button>
                    <button @click="equipItem(item)" class="equip-btn">装備</button>
                 </template>
              </div>
            </li>
          </ul>
        </div>
      </div>

      <div v-if="state.location === 'town'" class="scene town">
        <h3>【 街 (移動コスト: {{ moveCost }}分) 】</h3>
        <p class="town-info" v-if="moveCost >= 100">※徒歩は地獄。まずバイク屋を目指せ。</p>
        <div class="map-grid">
          <button @click="goToStore('hardoff', 'ハードオフ')" class="shop-btn">
            🏠 ハードオフ<br><small>ゴミか宝か</small>
            <span v-if="state.isTrendKnown" class="trend-hint">注:{{ state.shopTrends['hardoff'] }}</span>
          </button>
          <button @click="goToStore('bagshop', 'カバンのナカミチ')" class="shop-btn bag-shop">
            👜 カバン屋<br><small>装備がないと詰む</small>
          </button>
          <button @click="goToStore('bike', 'サイクルベース')" class="shop-btn bike-shop">
            🚲 バイク屋<br><small>移動短縮</small>
          </button>
          <button @click="goToStore('clothing', '古着屋')" class="shop-btn">
            👕 古着屋<br><small>流行を追え</small>
            <span v-if="state.isTrendKnown" class="trend-hint">注:{{ state.shopTrends['clothing'] }}</span>
          </button>
          <button @click="goToStore('pawn', '高級質屋')" class="shop-btn pawn-shop">
            💍 高級質屋<br><small>ハイリスク</small>
          </button>
          <button @click="state.location = 'bookstore'" class="shop-btn info">
            📚 本屋<br><small>トレンド情報</small>
          </button>
          <button @click="state.location = 'labor'" class="shop-btn labor">
            ⛑ 日雇い<br><small>破産回避</small>
          </button>
          <button @click="visitTemple" class="shop-btn temple">
            ⛩ 寺<br><small>厄払い・呪物浄化</small>
          </button>
        </div>
        <button class="back-btn" @click="state.location = 'home'">帰宅</button>
      </div>

      <div v-if="state.location === 'store'" class="scene store">
        <p class="area-badge">{{ state.currentShopName }}</p>
        <div class="item-card" :class="{'rare-bg': state.currentShopItem?.itemType !== 'merch'}">
          <p class="category-badge">{{ state.currentShopItem?.category }}</p>
          <p class="item-name">{{ state.currentShopItem?.name }}</p>
          <p class="desc">{{ state.currentShopItem?.description }}</p>
          <p class="price">価格: ￥{{ state.currentShopItem?.buyPrice.toLocaleString() }}</p>
          
          <div v-if="state.currentShopItem?.itemType !== 'merch'" class="equip-alert">
             ★攻略必須級アイテム！
          </div>
          <div v-if="state.isTrendKnown && state.currentShopItem?.category === state.shopTrends[state.currentShopType]" class="trend-match">
             ★トレンド商品 (期待値3倍)
          </div>

          <div class="actions">
            <button @click="buy">仕入れる</button>
            <button @click="state.currentShopItem = generateItem(state.currentShopType)">スルー</button>
          </div>
        </div>
        <button class="back-btn" @click="state.location = 'town'">店を出る</button>
      </div>

      <div v-if="state.location === 'mercari_prep'" class="overlay">
        <div class="phone">
          <div class="phone-header">配送方法の選択</div>
          <p class="item-name-sm">{{ state.negotiatingItem?.name }}</p>
          <p style="font-size:0.8rem; color:#666; margin-bottom:10px;">ターゲット客層を選んでください。</p>
          
          <div class="shipping-opts">
            <button @click="state.selectedShipping='anonymous'; confirmListing()" class="ship-btn">
              📦 匿名配送 (標準)<br><small>客層: ランダム</small>
            </button>
            <button @click="state.selectedShipping='fast'; confirmListing()" class="ship-btn fast">
              🚚 速達・プロ向<br><small>客: マニア多め (高額/高リスク)</small>
            </button>
            <button @click="state.selectedShipping='hand'; confirmListing()" class="ship-btn hand">
              🤝 手渡し・地元<br><small>客: キッズ多め (激安/人間性UP)</small>
            </button>
          </div>
          <button @click="state.location='home'" class="deny">やめる</button>
        </div>
      </div>

      <div v-if="state.location === 'mercari'" class="overlay">
        <div class="phone">
          <div class="phone-header">通知 (客層: {{ state.customerType }})</div>
          <div class="bubble user">{{ state.customerComment }}</div>
          <div class="offer">提示額: ￥{{ state.customerOfferPrice.toLocaleString() }}</div>
          <div class="phone-actions">
            <button @click="finishDeal(true)" class="accept">売る</button>
            <button @click="negotiateOneShot()" class="negotiate-btn" :disabled="!state.canNegotiate">
              強気交渉 (+25% or 決裂)
            </button>
            <button @click="finishDeal(false)" class="deny">取り下げ</button>
          </div>
          <p class="hint">交渉は一発勝負です。失敗すると取引が中止されます。</p>
        </div>
      </div>
      
      <div v-if="state.location === 'bookstore'" class="scene bookstore">
        <h3>【 本屋 】</h3>
        <p>週刊せどりウォーカー: ￥1200</p>
        <p>これを読むと、7日間トレンド商品（売値3倍）が分かる。</p>
        <button @click="buyMagazine" :disabled="state.magazineRemainingDays > 0">
          <span v-if="state.magazineRemainingDays > 0">あと{{ state.magazineRemainingDays }}日有効</span>
          <span v-else>購入 (￥1200)</span>
        </button>
        <button class="back-btn" @click="state.location = 'town'">戻る</button>
      </div>

      <div v-if="state.location === 'temple'" class="scene temple-scene">
        <h3>【 寺 】</h3>
        <div class="inventory-box mini-inv">
          <p>所持している呪物 (浄化料: ￥3000)</p>
          <ul>
            <li v-for="item in cursedInventory" :key="item.id" class="inv-item">
               <span class="cursed-text">{{ item.name }}</span>
               <button @click="purifyItem(item)" class="purify-btn">浄化する</button>
            </li>
          </ul>
          <p v-if="cursedInventory.length === 0" style="font-size:0.8rem; color:#888; margin-top:10px;">
            現在、呪物は所持していません。
          </p>
        </div>
        
        <div class="actions">
           <button @click="prayAtTemple">厄払い祈祷 (￥1000)</button>
        </div>
        <p style="margin-top:10px; font-size:0.8rem;">効果: メンタル回復 / 警戒度(Alert)ダウン</p>
        <button class="back-btn" @click="state.location = 'town'">戻る</button>
      </div>

      <div v-if="state.location === 'labor'" class="scene labor-scene">
        <h3>【 日雇い斡旋所 】</h3>
        <p class="alert" style="font-size:0.8rem">※作業中に事故が起きると給料半額です</p>
        <div class="labor-list">
           <button @click="doDayLabor('light')" :disabled="state.hp < 15">
             軽作業 (HP-15 / ￥1500)
           </button>
           <button @click="doDayLabor('normal')" :disabled="state.hp < 30">
             引越し (HP-30 / ￥2500+)
           </button>
           <button @click="doDayLabor('hard')" class="hard-labor" :disabled="state.hp < 50">
             危険作業 (HP-50 / ￥7000)<br><small>※要Labor Lv3</small>
           </button>
        </div>
        <p>現在のLabor Lv: {{ state.laborLevel }}</p>
        <button class="back-btn" @click="state.location = 'town'">戻る</button>
      </div>

    </main>

    <footer>{{ state.message }}</footer>
  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=DotGothic16&display=swap');

.game-container, .game-over-screen {
  width: 100vw; height: 100vh; height: 100dvh; background: #111; color: #eee;
  font-family: 'DotGothic16', sans-serif; display: flex; flex-direction: column;
  position: relative; overflow: hidden;
}
.game-container::before {
  content: " ";
  display: block;
  position: absolute;
  top: 0; left: 0; bottom: 0; right: 0;
  background: linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.25) 50%), linear-gradient(90deg, rgba(255, 0, 0, 0.06), rgba(0, 255, 0, 0.02), rgba(0, 0, 255, 0.06));
  z-index: 2;
  background-size: 100% 2px, 3px 100%;
  pointer-events: none;
}

/* Glitch Effect */
.glitch-active {
  animation: glitch-anim 0.2s cubic-bezier(.25, .46, .45, .94) both infinite;
  filter: hue-rotate(90deg) invert(1);
}
@keyframes glitch-anim {
  0% { transform: translate(0) }
  20% { transform: translate(-5px, 5px) }
  40% { transform: translate(-5px, -5px) }
  60% { transform: translate(5px, 5px) }
  80% { transform: translate(5px, -5px) }
  to { transform: translate(0) }
}

.game-over-screen { align-items: center; justify-content: center; padding: 20px; text-align: center; }
.ending h1 { color: #ffff55; }
.ending .score-board { border: 2px solid #fff; padding: 20px; margin: 20px; }
.fail-msg { color: #ff5555; font-size: 1.2rem; margin-top: 20px; }

header { 
  background: #222; padding: 5px; border-bottom: 2px solid #555; 
  padding-top: env(safe-area-inset-top);
}
.status-row { display: flex; justify-content: space-between; padding: 0 10px; font-size: 0.9rem; }
.equip-row { background: #003333; padding: 2px 10px; font-size: 0.8rem; color: #88ffff; display: flex; justify-content: space-between; }
.money { color: #ffff55; }
.money.debt { color: #ff0000; animation: blink 0.5s infinite; }
.critical { color: red; animation: blink 0.5s infinite; }
.bad { color: #aa00aa; }
.alert { color: #ff5500; font-weight: bold; }

main { 
  flex: 1; padding: 10px; overflow-y: auto; position: relative; 
  padding-left: max(10px, env(safe-area-inset-left));
  padding-right: max(10px, env(safe-area-inset-right));
}
.scene { height: 100%; display: flex; flex-direction: column; gap: 10px; }

.menu-buttons { display: flex; gap: 10px; margin-bottom: 5px; }
.menu-buttons button { flex: 1; padding: 10px; }
.tips-box { background: #002200; padding: 8px; border: 1px solid #005500; font-size: 0.8rem; margin-bottom: 5px; }
.exp-bar { color: #88ff88; float: right; }

/* Tabs */
.tabs { display: flex; border-bottom: 1px solid #444; }
.tabs button { flex: 1; background: #222; color: #666; border: none; padding: 5px; font-size: 0.8rem; }
.tabs button.active { background: #444; color: #fff; border-bottom: 2px solid #ffff55; }

/* Inventory */
.inventory-box { flex: 1; overflow-y: auto; background: #000; border: 1px solid #333; padding: 5px; }
.inv-item { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px dashed #333; padding: 5px; }
.inv-info { flex: 1; }
.effect-text { color: #00aaff; font-size: 0.75rem; display: block; }
.price-reveal { color: #00ff00; margin-left: 5px; }
.badge { font-size: 0.7rem; background: #444; padding: 1px 3px; margin-left: 3px; }
.cursed-text { color: #aa00aa; }
.sell-btn { background: #aa0000; border: 1px solid #ff5555; }
.equip-btn { background: #00aa00; border: 1px solid #55ff55; color: #fff; }
.purify-btn { background: #fff; color: #000; font-size: 0.7rem; margin-left:10px; }
.mini-inv { max-height: 150px; flex: none; margin-bottom: 10px; }

/* Map */
.map-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; flex: 1; }
.shop-btn { padding: 10px; text-align: left; background: #222; border: 1px solid #555; position: relative; }
.shop-btn:disabled { background: #111; color: #444; border-color: #333; }
.bag-shop { border-color: #ffaa00; background: #331100; }
.bike-shop { border-color: #00aaff; background: #001133; }
.pawn-shop { border-color: #ff00ff; background: #330033; }
.labor { border-color: #ffff00; background: #333300; }
.temple { border-color: #888; background: #444; color: #ccc; }
.trend-hint { color: #ffff55; display: block; font-size: 0.7rem; }
.town-info { color: #ff5555; font-size: 0.8rem; text-align: center; }

/* Store */
.item-card { border: 4px double #fff; padding: 15px; text-align: center; margin: 10px; background: #000; }
.rare-bg { background: #110033; border-color: #ff00ff; }
.equip-alert { color: #ffff00; animation: blink 1s infinite; margin: 5px 0; }
.trend-match { color: #ff5555; font-weight: bold; margin: 5px 0; border: 1px solid #ff5555; padding: 2px; }
.actions { display: flex; gap: 10px; justify-content: center; margin-top: 15px; }
.actions button { padding: 10px 20px; }

/* Touch Feedback */
button:active {
  transform: scale(0.96);
  filter: brightness(0.8);
}


/* Mercari & Shipping */
.overlay { position: absolute; top:0; left:0; width:100%; height:100%; background: rgba(0,0,0,0.9); display: flex; justify-content: center; align-items: center; z-index: 100; }
.phone { width: 90%; background: #fff; color: #000; padding: 15px; border-radius: 10px; }
.phone-header { font-weight: bold; border-bottom: 1px solid #ccc; margin-bottom: 10px; }
.bubble { background: #eee; padding: 10px; border-radius: 8px; margin-bottom: 10px; }
.offer { font-size: 1.5rem; color: #ff0055; text-align: center; margin: 15px 0; font-weight: bold; }
.phone-actions { display: flex; gap: 5px; }
.phone-actions button { flex: 1; padding: 10px 5px; font-weight: bold; color: #fff; border: none; font-size: 0.9rem; }
.accept { background: #ff0055; }
.negotiate-btn { background: #00aa00; }
.deny { background: #555; }
.hint { font-size: 0.7rem; color: #666; margin-top: 10px; text-align: center; }

.shipping-opts { display: flex; flex-direction: column; gap:10px; margin-bottom: 10px; }
.ship-btn { padding: 10px; text-align: left; background: #f0f0f0; border: 1px solid #ccc; color: #000; }
.ship-btn.fast { background: #eef; border-color: #aaf; }
.ship-btn.hand { background: #efe; border-color: #afa; }

/* Labor */
.labor-list { display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px; }
.labor-list button { padding: 15px; text-align: left; }
.hard-labor { border: 1px solid red; color: #ffaaaa; }

/* Temple */
.temple-scene { text-align: center; justify-content: flex-start; }

footer { 
  padding: 5px; border-top: 2px solid #555; color: #88ff88; font-size: 0.8rem; 
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  padding-bottom: max(5px, env(safe-area-inset-bottom));
}
/* Title Screen & Manual */
.start-screen { 
  display: flex; flex-direction: column; align-items: center; justify-content: center; 
  width: 100%; height: 100dvh; 
  text-align: center; background: #111;
}
.start-opts { display: flex; flex-direction: column; gap: 15px; margin-top: 20px; width: 80%; max-width: 300px; }
.resume-btn { background: #004400; border-color: #00ff00; color: #fff; padding: 15px; font-size: 1.2rem; }
.newgame-btn { padding: 15px; }
.hard-mode { background: #330000; border-color: #ff3333; color: #ffaaaa; }
.manual-btn { background: #003366; border-color: #4488ff; color: #aaccff; margin-top: 10px; }
.data-manage { margin-top: 30px; }
.delete-btn { background: #330000; border-color: #ff0000; font-size: 0.8rem; color: #ffaaaa; }

/* Manual Overlay */
.manual-overlay {
  position: absolute; top: 0; left: 0; width: 100%; height: 100%;
  background: rgba(0,0,0,0.95); z-index: 200;
  display: flex; flex-direction: column; padding: 20px; box-sizing: border-box;
  overflow-y: auto; text-align: left;
}
.manual-content { flex: 1; color: #ccc; font-size: 0.9rem; line-height: 1.6; }
.manual-content h2 { color: #ffff55; border-bottom: 2px solid #555; margin-bottom: 15px; }
.manual-content h3 { color: #88ff88; margin-top: 20px; margin-bottom: 5px; border-left: 4px solid #00aa00; padding-left: 10px; }
.manual-content strong { color: #fff; }
.manual-close { margin-top: 20px; background: #555; border: 1px solid #aaa; padding: 15px; width: 100%; font-weight: bold; }

/* Police Modal */
.police-overlay {
  position: absolute; top:0; left:0; width:100%; height:100%;
  background: rgba(50, 0, 0, 0.9); z-index: 300;
  display: flex; justify-content: center; align-items: center;
}
.police-alert {
  background: #000; border: 4px double #ff0000; padding: 20px; text-align: center;
  width: 90%; max-width: 400px;  box-shadow: 0 0 20px #ff0000;
}
.police-alert h2 { color: #ff0000; font-size: 2rem; margin-bottom: 20px; animation: blink 0.5s infinite; }
.police-msg { white-space: pre-wrap; margin-bottom: 20px; text-align: left; line-height: 1.6; }

/* Curse Modal */
.curse-overlay {
  position: absolute; top:0; left:0; width:100%; height:100%;
  background: rgba(20, 0, 20, 0.9); z-index: 310;
  display: flex; justify-content: center; align-items: center;
}
.curse-alert {
  background: #000; border: 4px double #aa00aa; padding: 20px; text-align: center;
  width: 90%; max-width: 400px; box-shadow: 0 0 20px #880088;
}
.curse-alert h2 { color: #aa00aa; font-size: 2rem; margin-bottom: 20px; }
.curse-msg { white-space: pre-wrap; margin-bottom: 20px; color: #d8bfd8; line-height: 1.6; }

button { background: #333; color: #fff; border: 1px solid #777; cursor: pointer; font-family: inherit; }
button:disabled { opacity: 0.5; cursor: not-allowed; }
.start-opts { display: flex; flex-direction: column; gap: 15px; margin-top: 20px; width: 80%; max-width: 300px; }
.resume-btn { background: #004400; border-color: #00ff00; color: #fff; padding: 15px; font-size: 1.2rem; }
.newgame-btn { padding: 15px; }
.data-manage { margin-top: 30px; }
.delete-btn { background: #330000; border-color: #ff0000; font-size: 0.8rem; color: #ffaaaa; }

/* Responsive adjustments for small screens (iPhone SE, etc.) */
@media (max-width: 400px) {
  .game-container { font-size: 0.9rem; }
  h1 { font-size: 1.5rem; }
  header { font-size: 0.8rem; }
  .status-row, .equip-row { font-size: 0.75rem; }
  .map-grid { gap: 5px; }
  .shop-btn { padding: 8px; }
  .item-card { margin: 5px; padding: 10px; }
  .inventory-box { padding: 2px; }
}

@media (max-height: 700px) {
  .scene { gap: 5px; }
  header { padding: 2px; }
  .map-grid { overflow-y: auto; }
  .item-card { padding: 5px; margin: 2px; border-width: 2px; }
  .actions { margin-top: 5px; }
  .actions button { padding: 5px 10px; }
  .mini-inv { max-height: 100px; }
}
</style>
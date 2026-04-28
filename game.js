/* =====================================================
   HOT DOG TYCOON - Game Logic
   A web-based life sim where you're a hot dog climbing
   the corporate ladder in the big city.
===================================================== */

// ---------- CONFIG ----------
// Backend API for global leaderboard. Override at runtime via:
//   localStorage.setItem('hdt_api', 'https://your-api-host')
// or by setting window.HDT_API_URL before this script loads.
const API_URL = (typeof window !== 'undefined' && window.HDT_API_URL)
  || (typeof localStorage !== 'undefined' && localStorage.getItem('hdt_api'))
  || ''; // empty disables global leaderboard (falls back to local)

const SAVE_KEY = 'hdt_save_v3';
const LOCAL_LB_KEY = 'hdt_lb_local';
const PLAYER_NAME_KEY = 'hdt_name';

// ---------- BALANCE / DIFFICULTY ----------
// Game-minutes per real-second when idle. Lower = slower. Was 15 in v2.
const IDLE_TIME_RATE = 4.5;
// Net worth required (in addition to Mogul level) to win.
const WIN_NET_WORTH = 300000;
// XP fatigue: each repeat of the same action key in a day multiplies XP by this.
const XP_FATIGUE = 0.8;
// Day-based inflation factor for rent and upkeep.
const INFLATION_PER_DAY = 0.04;
// Passive stat drain per game-minute.
const ENERGY_DRAIN = 0.012;
const HUNGER_DRAIN = 0.010;
// Mood drain per game-minute when stressed (high career level).
const MOOD_DRAIN_BASE = 0.004;

// ---------- GAME STATE ----------
const state = {
  money: 60,
  energy: 100,
  hunger: 100,
  mood: 80,
  xp: 0,
  careerLevel: 0,        // index into CAREERS
  day: 1,
  timeMin: 6 * 60,       // 6:00 AM, in minutes (0..1440)
  cameraX: 0,            // world scroll
  playerWorldX: 400,     // player's actual world position
  playerVel: 0,
  facing: 1,             // 1 right, -1 left
  walking: false,
  inBuilding: null,
  hasJob: false,
  ownsCart: false,
  ownsApartment: false,
  investments: 0,        // value invested
  outfit: 'plain',       // plain, tie, suit, tux, ceo
  totalEarned: 0,
  hasWon: false,

  // 3D interior state
  interiorBuildingId: null,
  interiorPlayerX: 200,
  interiorCameraX: 0,
  interiorFacing: 1,
  interiorWalking: false,

  // New mechanics
  factoryOwned: false,
  factoryAutomation: 0,        // 0..3
  factoryAccumulated: 0,        // pending passive income
  stockShares: { frank: 0, bun: 0, kraft: 0 },
  stockPrices: { frank: 200, bun: 300, kraft: 500 },
  educationLevel: 0,            // 0=none, 1=class taken, 2=MBA
  ownsMansion: false,
  sick: 0,                      // 0 = healthy, otherwise days remaining sick

  // Difficulty / pacing
  xpFatigue: {},                // per-day {actionKey: count} → diminishing XP returns
  sickStreak: 0,                // total days spent sick (cosmetic, for events)
};

// ---------- CAREER LADDER ----------
const CAREERS = [
  { title: 'Unemployed Wiener',  xpToNext: 0,     pay: 0,    outfit: 'plain' },
  { title: 'Street Cart Vendor', xpToNext: 60,    pay: 8,    outfit: 'plain' },
  { title: 'Office Intern',      xpToNext: 160,   pay: 18,   outfit: 'tie' },
  { title: 'Junior Frankfurter', xpToNext: 360,   pay: 35,   outfit: 'tie' },
  { title: 'Sales Associate',    xpToNext: 700,   pay: 60,   outfit: 'suit' },
  { title: 'Manager Mustard',    xpToNext: 1200,  pay: 100,  outfit: 'suit' },
  { title: 'VP of Buns',         xpToNext: 2000,  pay: 180,  outfit: 'suit' },
  { title: 'Executive Wiener',   xpToNext: 3100,  pay: 320,  outfit: 'tux' },
  { title: 'CEO Frankfurter',    xpToNext: 4600,  pay: 600,  outfit: 'tux' },
  { title: 'Hot Dog Mogul',      xpToNext: 6500,  pay: 1200, outfit: 'ceo' },
  { title: 'Frankfurter Baron',  xpToNext: 9500,  pay: 2500, outfit: 'ceo' },
  { title: 'Wiener Tycoon',      xpToNext: Infinity, pay: 5000, outfit: 'ceo' },
];

// ---------- BUILDINGS (city overworld) ----------
const BUILDING_DEFS = [
  { id: 'home',       name: 'Tiny Apartment',       icon: '🏠', color: '#a87858', windows: [3,2], height: 200, x: 200 },
  { id: 'cart',       name: "Frank's Hot Dog Cart", icon: '🌭', color: '#ff7a59', windows: [1,1], height: 100, x: 520 },
  { id: 'bakery',     name: 'Golden Bun Bakery',    icon: '🥐', color: '#d4a574', windows: [2,2], height: 170, x: 860 },
  { id: 'diner',      name: "Mama's Diner",         icon: '🍔', color: '#d4584a', windows: [3,2], height: 220, x: 1200 },
  { id: 'gym',        name: 'Iron Bun Gym',         icon: '💪', color: '#5a7a8a', windows: [4,3], height: 280, x: 1560 },
  { id: 'park',       name: 'Central Park',         icon: '🌳', color: '#4a7a3a', windows: [0,0], height: 80,  x: 1920 },
  { id: 'office',     name: 'Mustard Corp Office',  icon: '🏢', color: '#7a8aa0', windows: [4,5], height: 360, x: 2280 },
  { id: 'bank',       name: 'First National Bun',   icon: '🏦', color: '#cab87a', windows: [4,4], height: 320, x: 2700 },
  { id: 'shop',       name: 'Dapper Dog Outfits',   icon: '👔', color: '#9b6ab8', windows: [3,2], height: 240, x: 3120 },
  { id: 'bar',        name: 'The Relish Lounge',    icon: '🍻', color: '#5a4080', windows: [3,2], height: 200, x: 3520 },
  { id: 'subway',     name: 'Metro Bun Terminal',   icon: '🚇', color: '#3a5058', windows: [3,4], height: 260, x: 3920 },
  { id: 'university', name: 'Bun University',       icon: '🎓', color: '#8b5a8b', windows: [5,4], height: 340, x: 4360 },
  { id: 'hospital',   name: 'Sausage General',      icon: '🏥', color: '#e8eef4', windows: [4,5], height: 360, x: 4780 },
  { id: 'theater',    name: 'Wiener Theater',       icon: '🎭', color: '#8a4a5a', windows: [4,3], height: 300, x: 5200 },
  { id: 'casino',     name: 'Lucky Frank Casino',   icon: '🎰', color: '#5a1a1a', windows: [5,3], height: 280, x: 5620 },
  { id: 'arcade',     name: 'Pixel Bun Arcade',     icon: '👾', color: '#4a3a7a', windows: [3,3], height: 220, x: 6040 },
  { id: 'stocks',     name: 'Stock Exchange',       icon: '📈', color: '#1a3a4a', windows: [5,5], height: 380, x: 6460 },
  { id: 'hotel',      name: 'Grand Bun Hotel',      icon: '🏨', color: '#6a7a8a', windows: [4,6], height: 340, x: 6900 },
  { id: 'factory',    name: 'Hot Dog Factory',      icon: '🏭', color: '#5a5045', windows: [3,2], height: 260, x: 7340 },
  { id: 'food_truck', name: 'Rolling Frank Truck',  icon: '🚚', color: '#e85a3a', windows: [2,1], height: 140, x: 7760 },
  { id: 'museum',     name: 'Mustard Museum',       icon: '🖼️', color: '#c4b89a', windows: [4,3], height: 280, x: 8140 },
  { id: 'mansion',    name: 'Wiener Mansion',       icon: '🏰', color: '#6b3a65', windows: [6,4], height: 380, x: 8560 },
  { id: 'airport',    name: 'Frankfurter Intl',     icon: '✈️', color: '#8aa4c4', windows: [5,5], height: 360, x: 8980 },
  { id: 'tower',      name: 'Frankfurter Tower',    icon: '🗼', color: '#e8b04a', windows: [5,9], height: 520, x: 9420 },
];

const WORLD_WIDTH = 10200;

// ---------- 3D BUILDING INTERIORS ----------
// Each interior has a theme + decor + an array of stations.
// Stations support a `cond` (visible only when true) and `disable` (greyed out).
const BUILDING_INTERIORS = {
  home: {
    name: 'Tiny Apartment',
    icon: '🏠',
    theme: 'home',
    subtitle: 'Home sweet hot dog home.',
    decor: ['🪟', '🖼️', '🪴', '📺'],
    width: 1500,
    stations: () => [
      { x: 250, icon: '🛌', label: 'Quick Nap', action: 'sleep_short' },
      { x: 500, icon: '💤', label: 'Full Sleep', action: 'sleep_long' },
      { x: 800, icon: '📺', label: 'Watch TV', action: 'tv' },
      { x: 1100, icon: state.ownsApartment ? '🏘️' : '🏘️', label: state.ownsApartment ? 'Penthouse Owned' : 'Upgrade Penthouse', action: 'buy_apartment', price: '$2,000', priceClass: 'loss', disable: state.ownsApartment || state.money < 2000 },
    ],
  },
  cart: {
    name: "Frank's Hot Dog Cart",
    icon: '🌭',
    theme: 'cart',
    subtitle: 'The grease-stained foundation of every empire.',
    decor: ['🌭', '🥫', '🧂', '☂️'],
    width: 1300,
    stations: () => [
      state.ownsCart
        ? { x: 300, icon: '🔥', label: 'Work the Cart (1hr)', action: 'work_cart', price: '+$' + cartPay(), priceClass: 'gain' }
        : { x: 300, icon: '💰', label: 'Buy the Cart', action: 'buy_cart', price: '$50', priceClass: 'loss', disable: state.money < 50 },
      ...(state.ownsCart && state.careerLevel === 0
        ? [{ x: 600, icon: '🎉', label: 'Become Vendor', action: 'start_vendor' }]
        : []),
      { x: 900, icon: '🌭', label: 'Eat a Hot Dog', action: 'eat_dog', price: '$3', priceClass: 'loss', disable: state.money < 3 },
    ],
  },
  diner: {
    name: "Mama's Diner",
    icon: '🍔',
    theme: 'diner',
    subtitle: 'Greasy spoon. Comfort food. Refill that hunger.',
    decor: ['🍔', '🍟', '🥤', '🥩'],
    width: 1500,
    stations: () => [
      { x: 280, icon: '🍟', label: 'Fries', action: 'eat_snack', price: '$5', priceClass: 'loss', disable: state.money < 5 },
      { x: 550, icon: '🍔', label: 'Burger Combo', action: 'eat_meal', price: '$15', priceClass: 'loss', disable: state.money < 15 },
      { x: 850, icon: '🥩', label: 'Steak Dinner', action: 'eat_feast', price: '$45', priceClass: 'loss', disable: state.money < 45 },
      { x: 1180, icon: '🍰', label: 'Birthday Cake', action: 'eat_cake', price: '$25', priceClass: 'loss', disable: state.money < 25 },
    ],
  },
  gym: {
    name: 'Iron Bun Gym',
    icon: '💪',
    theme: 'gym',
    subtitle: 'Get those buns toned, your career fit.',
    decor: ['🏋️', '🚴', '🥇', '♨️'],
    width: 1500,
    stations: () => [
      { x: 280, icon: '🏋️', label: 'Workout (1hr)', action: 'workout', price: '$10', priceClass: 'loss', disable: state.money < 10 || state.energy < 20 },
      { x: 600, icon: '🚴', label: 'Cardio (45min)', action: 'cardio', price: '$8', priceClass: 'loss', disable: state.money < 8 },
      { x: 900, icon: '♨️', label: 'Sauna', action: 'sauna', price: '$8', priceClass: 'loss', disable: state.money < 8 },
      { x: 1200, icon: '🧘', label: 'Yoga Class', action: 'yoga', price: '$12', priceClass: 'loss', disable: state.money < 12 },
    ],
  },
  park: {
    name: 'Central Park',
    icon: '🌳',
    theme: 'park',
    subtitle: 'Fresh air, free entertainment.',
    decor: ['🌳', '🌷', '🌳', '🌷'],
    width: 1500,
    stations: () => [
      { x: 280, icon: '🚶', label: 'Take a Walk', action: 'walk_park' },
      { x: 580, icon: '🐦', label: 'Feed the Birds', action: 'feed_birds', price: '$2', priceClass: 'loss', disable: state.money < 2 },
      { x: 880, icon: '🥺', label: 'Beg for Change', action: 'beg' },
      { x: 1180, icon: '🎨', label: 'Sell Art', action: 'sell_art', price: '+$' + (5 + state.careerLevel * 2), priceClass: 'gain' },
    ],
  },
  office: {
    name: 'Mustard Corp Office',
    icon: '🏢',
    theme: 'office',
    subtitle: 'The cubicle farm. The corporate ladder. Your future.',
    decor: ['💻', '☕', '📊', '🗄️'],
    width: 1700,
    stations: () => {
      const canApply = !state.hasJob && state.careerLevel >= 1;
      const list = [];
      if (state.hasJob) {
        list.push({ x: 280, icon: '💼', label: 'Do Some Work (2hrs)', action: 'work_office', price: '+$' + jobPay(), priceClass: 'gain' });
        if (state.careerLevel < CAREERS.length - 1) {
          list.push({
            x: 600,
            icon: '🚀',
            label: state.xp >= CAREERS[state.careerLevel].xpToNext ? 'Ask for Promotion' : `Need ${CAREERS[state.careerLevel].xpToNext} XP`,
            action: 'try_promote',
            disable: state.xp < CAREERS[state.careerLevel].xpToNext,
          });
        }
        list.push({ x: 950, icon: '🗣️', label: 'Attend Meeting', action: 'meeting' });
        list.push({ x: 1280, icon: '☕', label: 'Coffee Break', action: 'coffee', price: '$5', priceClass: 'loss', disable: state.money < 5 });
      } else {
        list.push({
          x: 600,
          icon: '📄',
          label: canApply ? 'Apply for Internship' : 'Be a vendor first',
          action: 'apply_job',
          disable: !canApply,
        });
      }
      return list;
    },
  },
  bank: {
    name: 'First National Bun',
    icon: '🏦',
    theme: 'bank',
    subtitle: 'Where money sleeps and grows.',
    decor: ['💰', '🏦', '💵', '📊'],
    width: 1500,
    stations: () => [
      { x: 280, icon: '📊', label: 'Invest $100', action: 'invest_100', price: '$100', priceClass: 'loss', disable: state.money < 100 },
      { x: 580, icon: '💎', label: 'Invest $1,000', action: 'invest_1000', price: '$1,000', priceClass: 'loss', disable: state.money < 1000 },
      { x: 880, icon: '🏦', label: 'Invest $10,000', action: 'invest_10k', price: '$10,000', priceClass: 'loss', disable: state.money < 10000 },
      { x: 1180, icon: '💵', label: `Withdraw $${Math.floor(state.investments)}`, action: 'withdraw_all', price: '+$' + Math.floor(state.investments), priceClass: 'gain', disable: state.investments < 1 },
    ],
  },
  shop: {
    name: 'Dapper Dog Outfits',
    icon: '👔',
    theme: 'shop',
    subtitle: 'Dress the part. Play the part. Slay the part.',
    decor: ['👔', '🤵', '🎩', '💎'],
    width: 1500,
    stations: () => {
      const has = (o) => ['tie', 'suit', 'tux', 'ceo'].indexOf(state.outfit) >= ['tie', 'suit', 'tux', 'ceo'].indexOf(o);
      return [
        { x: 280, icon: '👔', label: has('tie') ? 'Tie (Owned)' : 'Business Tie', action: 'buy_tie', price: has('tie') ? 'Owned' : '$50', priceClass: 'loss', disable: has('tie') || state.money < 50 },
        { x: 580, icon: '🤵', label: has('suit') ? 'Suit (Owned)' : 'Power Suit', action: 'buy_suit', price: has('suit') ? 'Owned' : '$300', priceClass: 'loss', disable: has('suit') || state.money < 300 },
        { x: 880, icon: '🎩', label: has('tux') ? 'Tuxedo (Owned)' : 'Tuxedo', action: 'buy_tux', price: has('tux') ? 'Owned' : '$1,200', priceClass: 'loss', disable: has('tux') || state.money < 1200 },
        { x: 1180, icon: '💎', label: state.outfit === 'ceo' ? 'CEO (Owned)' : 'CEO Ensemble', action: 'buy_ceo', price: state.outfit === 'ceo' ? 'Owned' : '$5,000', priceClass: 'loss', disable: state.outfit === 'ceo' || state.money < 5000 },
      ];
    },
  },
  bar: {
    name: 'The Relish Lounge',
    icon: '🍻',
    theme: 'bar',
    subtitle: 'Where deals are made and dignity is lost.',
    decor: ['🍻', '🎤', '🍷', '🎲'],
    width: 1500,
    stations: () => [
      { x: 280, icon: '🍺', label: 'Have a Beer', action: 'drink_beer', price: '$8', priceClass: 'loss', disable: state.money < 8 },
      { x: 600, icon: '🤝', label: 'Network with Suits', action: 'network', price: '$25', priceClass: 'loss', disable: state.money < 25 },
      { x: 900, icon: '🎤', label: 'Sing Karaoke', action: 'karaoke', price: '$5', priceClass: 'loss', disable: state.money < 5 },
      { x: 1200, icon: '🍷', label: 'Premium Wine', action: 'wine', price: '$50', priceClass: 'loss', disable: state.money < 50 },
    ],
  },
  university: {
    name: 'Bun University',
    icon: '🎓',
    theme: 'university',
    subtitle: 'Education: the smart hot dog\'s investment.',
    decor: ['📚', '🎓', '🔬', '🖋️'],
    width: 1500,
    stations: () => [
      { x: 280, icon: '📚', label: 'Take a Class', action: 'take_class', price: '$100', priceClass: 'loss', disable: state.money < 100 },
      { x: 600, icon: '🎓', label: state.educationLevel >= 2 ? 'MBA Earned' : 'Earn MBA', action: 'mba', price: state.educationLevel >= 2 ? 'Done' : '$1,500', priceClass: 'loss', disable: state.educationLevel >= 2 || state.money < 1500 },
      { x: 950, icon: '🔬', label: 'Research Project', action: 'research', price: '$300', priceClass: 'loss', disable: state.money < 300 },
      { x: 1250, icon: '📖', label: 'Library Study (free)', action: 'study' },
    ],
  },
  hospital: {
    name: 'Sausage General Hospital',
    icon: '🏥',
    theme: 'hospital',
    subtitle: 'Patch yourself up. Hot dogs need maintenance too.',
    decor: ['💊', '🩺', '🚑', '🩹'],
    width: 1400,
    stations: () => [
      { x: 280, icon: '🩺', label: 'Health Checkup', action: 'checkup', price: '$50', priceClass: 'loss', disable: state.money < 50 },
      { x: 580, icon: '💊', label: 'Buy Medicine', action: 'medicine', price: '$80', priceClass: 'loss', disable: state.money < 80 },
      { x: 880, icon: '🚑', label: 'Full Treatment', action: 'full_treatment', price: '$300', priceClass: 'loss', disable: state.money < 300 },
      { x: 1180, icon: '💉', label: 'Energy Booster', action: 'booster', price: '$120', priceClass: 'loss', disable: state.money < 120 },
    ],
  },
  casino: {
    name: 'Lucky Frank Casino',
    icon: '🎰',
    theme: 'casino',
    subtitle: 'The house always wins. But sometimes you do too.',
    decor: ['🎰', '🃏', '🎲', '💎'],
    width: 1500,
    stations: () => [
      { x: 280, icon: '🎰', label: 'Slot Machine', action: 'slots', price: '$10', priceClass: 'loss', disable: state.money < 10 },
      { x: 580, icon: '🃏', label: 'Blackjack', action: 'blackjack', price: '$50', priceClass: 'loss', disable: state.money < 50 },
      { x: 880, icon: '🎲', label: 'Roulette', action: 'roulette', price: '$100', priceClass: 'loss', disable: state.money < 100 },
      { x: 1200, icon: '💎', label: 'High Roller', action: 'high_roller', price: '$1,000', priceClass: 'loss', disable: state.money < 1000 },
    ],
  },
  stocks: {
    name: 'Stock Exchange',
    icon: '📈',
    theme: 'stocks',
    subtitle: 'Trade Frank Inc, Bun Co, and Kraft & Co stock.',
    decor: ['📈', '📉', '💹', '🐂'],
    width: 1700,
    stations: () => [
      { x: 280, icon: '🌭', label: `Frank Inc (${state.stockShares.frank}sh) $${Math.floor(state.stockPrices.frank)}`, action: 'buy_frank', price: '$' + Math.floor(state.stockPrices.frank), priceClass: 'loss', disable: state.money < state.stockPrices.frank },
      { x: 580, icon: '🍞', label: `Bun Co (${state.stockShares.bun}sh) $${Math.floor(state.stockPrices.bun)}`, action: 'buy_bun', price: '$' + Math.floor(state.stockPrices.bun), priceClass: 'loss', disable: state.money < state.stockPrices.bun },
      { x: 880, icon: '🧀', label: `Kraft & Co (${state.stockShares.kraft}sh) $${Math.floor(state.stockPrices.kraft)}`, action: 'buy_kraft', price: '$' + Math.floor(state.stockPrices.kraft), priceClass: 'loss', disable: state.money < state.stockPrices.kraft },
      { x: 1280, icon: '💰', label: 'Sell ALL Stocks', action: 'sell_stocks', price: '+$' + Math.floor(stockPortfolioValue()), priceClass: 'gain', disable: stockPortfolioValue() < 1 },
    ],
  },
  factory: {
    name: 'Hot Dog Factory',
    icon: '🏭',
    theme: 'factory',
    subtitle: 'Mass-produce franks. Generate passive income.',
    decor: ['🏭', '⚙️', '🌭', '🤖'],
    width: 1500,
    stations: () => {
      const list = [];
      if (!state.factoryOwned) {
        list.push({ x: 600, icon: '🏭', label: 'Buy the Factory', action: 'buy_factory', price: '$8,000', priceClass: 'loss', disable: state.money < 8000 });
      } else {
        list.push({ x: 280, icon: '👷', label: 'Run a Shift', action: 'factory_shift', price: '+$' + factoryShiftPay(), priceClass: 'gain' });
        list.push({ x: 580, icon: '💰', label: `Collect $${Math.floor(state.factoryAccumulated)}`, action: 'factory_collect', price: '+$' + Math.floor(state.factoryAccumulated), priceClass: 'gain', disable: state.factoryAccumulated < 1 });
        list.push({
          x: 880,
          icon: '🤖',
          label: state.factoryAutomation >= 3 ? 'MAX Automation' : `Automation Lvl ${state.factoryAutomation + 1}`,
          action: 'upgrade_automation',
          price: state.factoryAutomation >= 3 ? 'Maxed' : '$' + (5000 * (state.factoryAutomation + 1)).toLocaleString(),
          priceClass: 'loss',
          disable: state.factoryAutomation >= 3 || state.money < 5000 * (state.factoryAutomation + 1),
        });
        list.push({ x: 1200, icon: '🚛', label: 'Big Distribution Deal', action: 'big_deal', price: '$2,000', priceClass: 'loss', disable: state.money < 2000 });
      }
      return list;
    },
  },
  mansion: {
    name: 'Wiener Mansion',
    icon: '🏰',
    theme: 'mansion',
    subtitle: 'The luxury home only the truly successful can afford.',
    decor: ['🏰', '🛏️', '🏊', '🍷'],
    width: 1700,
    stations: () => {
      if (!state.ownsMansion) {
        return [{
          x: 700, icon: '🏰', label: 'Buy the Mansion', action: 'buy_mansion',
          price: '$25,000', priceClass: 'loss', disable: state.money < 25000,
        }];
      }
      return [
        { x: 280, icon: '🛏️', label: 'King Sleep', action: 'mansion_sleep' },
        { x: 580, icon: '🏊', label: 'Pool Day', action: 'pool' },
        { x: 880, icon: '🍷', label: 'Wine Cellar', action: 'wine_cellar' },
        { x: 1200, icon: '🥂', label: 'Throw a Party', action: 'party', price: '$1,000', priceClass: 'loss', disable: state.money < 1000 },
        { x: 1500, icon: '🎺', label: 'Hire Butler', action: 'butler', price: '$2,000', priceClass: 'loss', disable: state.money < 2000 },
      ];
    },
  },
  bakery: {
    name: 'Golden Bun Bakery',
    icon: '🥐',
    theme: 'bakery',
    subtitle: 'Fresh pastries — fuel for the grind.',
    decor: ['🥐', '🍞', '☕', '🧈'],
    width: 1400,
    stations: () => [
      { x: 300, icon: '🧁', label: 'Muffin & Coffee', action: 'bakery_muffin', price: '$4', priceClass: 'loss', disable: state.money < 4 },
      { x: 600, icon: '☕', label: 'Artisan Latte', action: 'bakery_latte', price: '$7', priceClass: 'loss', disable: state.money < 7 },
      { x: 900, icon: '🥨', label: 'Cronut Deluxe', action: 'bakery_cronut', price: '$18', priceClass: 'loss', disable: state.money < 18 },
    ],
  },
  subway: {
    name: 'Metro Bun Terminal',
    icon: '🚇',
    theme: 'subway',
    subtitle: 'Stand clear of the closing buns.',
    decor: ['🚇', '🗺️', '🎫', '⏱️'],
    width: 1400,
    stations: () => [
      { x: 400, icon: '🚇', label: 'Ride the Line (45min)', action: 'subway_ride', price: '$3', priceClass: 'loss', disable: state.money < 3 },
      { x: 900, icon: '🎸', label: 'Tip a Busker', action: 'subway_busker', price: '$5', priceClass: 'loss', disable: state.money < 5 },
    ],
  },
  theater: {
    name: 'Wiener Theater',
    icon: '🎭',
    theme: 'theater',
    subtitle: 'Culture with extra relish.',
    decor: ['🎭', '🎟️', '🎬', '🎻'],
    width: 1500,
    stations: () => [
      { x: 400, icon: '🎬', label: 'Matinee Movie', action: 'theater_movie', price: '$35', priceClass: 'loss', disable: state.money < 35 },
      { x: 950, icon: '🎭', label: 'Broadway Night', action: 'theater_broadway', price: '$120', priceClass: 'loss', disable: state.money < 120 },
    ],
  },
  arcade: {
    name: 'Pixel Bun Arcade',
    icon: '👾',
    theme: 'arcade',
    subtitle: 'Tickets, tokens, and questionable life choices.',
    decor: ['👾', '🕹️', '🎟️', '💫'],
    width: 1400,
    stations: () => [
      { x: 450, icon: '🎟️', label: 'Token Blast', action: 'arcade_ticket', price: '$15', priceClass: 'loss', disable: state.money < 15 },
      { x: 950, icon: '🏆', label: 'High Score Challenge', action: 'arcade_highscore', price: '$50', priceClass: 'loss', disable: state.money < 50 },
    ],
  },
  hotel: {
    name: 'Grand Bun Hotel',
    icon: '🏨',
    theme: 'hotel',
    subtitle: 'Sleep like someone who invoices room service.',
    decor: ['🏨', '🛎️', '🛏️', '🍾'],
    width: 1600,
    stations: () => [
      { x: 320, icon: '🛏️', label: 'Power Nap Suite', action: 'hotel_nap', price: '$45', priceClass: 'loss', disable: state.money < 45 },
      { x: 720, icon: '🍾', label: 'Networking Gala', action: 'hotel_gala', price: '$200', priceClass: 'loss', disable: state.money < 200 },
      { x: 1120, icon: '🥐', label: 'Sunday Brunch Buffet', action: 'hotel_brunch', price: '$65', priceClass: 'loss', disable: state.money < 65 },
    ],
  },
  food_truck: {
    name: 'Rolling Frank Truck',
    icon: '🚚',
    theme: 'food_truck',
    subtitle: 'Gourmet dogs on wheels.',
    decor: ['🚚', '🌭', '🔔', '📣'],
    width: 1300,
    stations: () => [
      { x: 420, icon: '🔥', label: 'Run the Truck (90min)', action: 'truck_shift', price: '+$' + truckPay(), priceClass: 'gain', disable: state.energy < 12 },
      { x: 880, icon: '🌭', label: 'Chef\'s Special Sample', action: 'truck_sample', price: '$6', priceClass: 'loss', disable: state.money < 6 },
    ],
  },
  museum: {
    name: 'Mustard Museum',
    icon: '🖼️',
    theme: 'museum',
    subtitle: 'High art. Low sodium.',
    decor: ['🖼️', '🏛️', '📜', '🧑‍🎨'],
    width: 1500,
    stations: () => [
      { x: 450, icon: '🖼️', label: 'Day Admission', action: 'museum_day', price: '$25', priceClass: 'loss', disable: state.money < 25 },
      { x: 950, icon: '🥂', label: 'Donor Gala', action: 'museum_gala', price: '$150', priceClass: 'loss', disable: state.money < 150 },
    ],
  },
  airport: {
    name: 'Frankfurter International',
    icon: '✈️',
    theme: 'airport',
    subtitle: 'Business class tastes better with ketchup.',
    decor: ['✈️', '🛄', '🛂', '🌍'],
    width: 1700,
    stations: () => [
      { x: 450, icon: '🛫', label: 'Shuttle Flight (business)', action: 'airport_shuttle', price: '$400', priceClass: 'loss', disable: state.money < 400 },
      { x: 1050, icon: '🌙', label: 'Red-Eye Deal Trip', action: 'airport_redeye', price: '$1,500', priceClass: 'loss', disable: state.money < 1500 },
    ],
  },
  tower: {
    name: 'Frankfurter Tower',
    icon: '🗼',
    theme: 'tower',
    subtitle: 'The pinnacle. Only moguls allowed.',
    decor: ['🏆', '👑', '💎', '🥇'],
    width: 1300,
    stations: () => {
      const reqLvl = 9; // Hot Dog Mogul
      const nw = networth();
      const meetsLevel = state.careerLevel >= reqLvl;
      const meetsWealth = nw >= WIN_NET_WORTH;
      if (meetsLevel && meetsWealth) {
        return [{ x: 650, icon: '🏆', label: 'Claim Mogul Status', action: 'win', price: 'WIN!', priceClass: 'gain' }];
      }
      const stations = [];
      if (!meetsLevel) {
        stations.push({ x: 480, icon: '📋', label: `Need career: Hot Dog Mogul (you: ${CAREERS[state.careerLevel].title})`, action: 'leave', disable: true });
      } else {
        stations.push({ x: 480, icon: '✅', label: 'Career: Hot Dog Mogul ✓', action: 'leave', disable: true });
      }
      if (!meetsWealth) {
        const remaining = (WIN_NET_WORTH - nw).toLocaleString();
        stations.push({ x: 820, icon: '💰', label: `Need net worth $${WIN_NET_WORTH.toLocaleString()} (need $${remaining} more)`, action: 'leave', disable: true });
      } else {
        stations.push({ x: 820, icon: '✅', label: `Net worth $${WIN_NET_WORTH.toLocaleString()} ✓`, action: 'leave', disable: true });
      }
      return stations;
    },
  },
};

// ---------- DOM REFS ----------
const $ = (id) => document.getElementById(id);
const elIntro = $('intro');
const elGame = $('game');
const elWorld = $('world');
const elCity = $('city');
const elPlayer = $('player');
const elNpcs = $('npcs');
const elNotifs = $('notifications');
const elModal = $('modal');
const elModalBody = $('modalBody');
const elParticles = $('particles');
const elOutfit = $('outfit');
const elPupilL = $('pupilL');
const elPupilR = $('pupilR');
const elEnterPrompt = $('enterPrompt');
const elInterior = $('interior');
const elInteriorRoom = $('interiorRoom');
const elBackWall = $('backWall');
const elFloor3d = $('floor3d');
const elStations = $('stations');
const elInteriorPlayer = $('interiorPlayer');
const elInteriorTitle = $('interiorTitle');
const elInteriorSubtitle = $('interiorSubtitle');
const elWallDecor = $('wallDecor');
const elInteriorPrompt = $('interiorPrompt');
const elOutfitInt = $('outfitInt');

// ---------- SETUP ----------
function init() {
  $('startBtn').addEventListener('click', () => startGame(false));
  $('modalClose').addEventListener('click', closeModal);
  $('restartBtn').addEventListener('click', () => {
    clearSave();
    location.reload();
  });
  $('exitBtn').addEventListener('click', exitInterior);
  $('continueBtn').addEventListener('click', () => startGame(true));
  $('leaderboardBtn').addEventListener('click', () => openLeaderboard('global'));
  $('viewLbBtn').addEventListener('click', () => openLeaderboard('global'));
  $('lbClose').addEventListener('click', closeLeaderboard);
  document.querySelectorAll('.lb-tab').forEach(t => {
    t.addEventListener('click', () => openLeaderboard(t.dataset.tab));
  });
  $('submitScoreBtn').addEventListener('click', submitScore);
  $('manualSaveBtn').addEventListener('click', () => { saveGame(); showSaveToast(); });
  $('resetGameBtn').addEventListener('click', () => {
    if (confirm('Reset and start a brand new game? Your save will be deleted.')) {
      clearSave();
      location.reload();
    }
  });

  // Show "Continue" if a save exists
  if (hasSave()) $('continueBtn').classList.remove('hidden');

  // Pre-fill player name from past plays
  const savedName = localStorage.getItem(PLAYER_NAME_KEY);
  if (savedName) $('winName').value = savedName;

  setupInput();
}

function startGame(continueGame) {
  elIntro.style.display = 'none';
  elGame.classList.remove('game-hidden');
  $('saveControls').classList.remove('hidden');

  let resumed = false;
  if (continueGame && hasSave()) {
    resumed = loadGame();
  }

  buildCity();
  spawnNpcs();
  renderHUD();
  renderOutfit();
  elCity.style.width = WORLD_WIDTH + 'px';

  if (resumed) {
    notify(`Welcome back, ${CAREERS[state.careerLevel].title}! Day ${state.day} resumed.`, 'epic');
  } else {
    notify('Welcome to the megacity strip! 🌭 Hit the cart, bakery, subway — press W to enter buildings.', 'epic');
  }

  // Autosave every 10 seconds
  setInterval(() => { if (!state.hasWon) saveGame(); }, 10000);
  // Save on tab close
  window.addEventListener('beforeunload', () => { if (!state.hasWon) saveGame(); });

  requestAnimationFrame(loop);
}

// ---------- CITY GENERATION ----------
function buildCity() {
  elCity.innerHTML = '';
  BUILDING_DEFS.forEach(def => {
    const b = document.createElement('div');
    b.className = 'building';
    b.dataset.id = def.id;
    b.style.left = def.x + 'px';
    b.style.position = 'absolute';
    b.style.background = `linear-gradient(180deg, ${shade(def.color, 1.1)}, ${shade(def.color, 0.6)})`;
    b.style.height = def.height + 'px';
    const w = 140 + (def.windows[0] * 8);
    b.style.width = w + 'px';

    const name = document.createElement('div');
    name.className = 'building-name';
    name.textContent = def.icon + ' ' + def.name;
    b.appendChild(name);

    const ic = document.createElement('div');
    ic.className = 'building-icon';
    ic.textContent = def.icon;
    b.appendChild(ic);

    if (def.windows[0] > 0) {
      const winGrid = document.createElement('div');
      winGrid.className = 'windows';
      winGrid.style.gridTemplateColumns = `repeat(${def.windows[0]}, 1fr)`;
      const total = def.windows[0] * def.windows[1];
      for (let i = 0; i < total; i++) {
        const win = document.createElement('div');
        win.className = 'window';
        win.style.height = '14px';
        if (Math.random() < 0.3) win.classList.add('dark');
        winGrid.appendChild(win);
      }
      b.appendChild(winGrid);
    }

    if (def.id !== 'park') {
      const door = document.createElement('div');
      door.className = 'door';
      b.appendChild(door);
    } else {
      // Park gets trees instead
      b.style.background = `linear-gradient(180deg, #6ba84a, #4a7a3a)`;
      for (let i = 0; i < 3; i++) {
        const tree = document.createElement('div');
        tree.style.cssText = `position:absolute;bottom:0;left:${i*40+10}px;font-size:48px;`;
        tree.textContent = '🌳';
        b.appendChild(tree);
      }
    }

    elCity.appendChild(b);
  });
}

function shade(hex, factor) {
  const c = parseInt(hex.slice(1), 16);
  let r = Math.min(255, Math.floor(((c >> 16) & 0xff) * factor));
  let g = Math.min(255, Math.floor(((c >> 8) & 0xff) * factor));
  let b = Math.min(255, Math.floor((c & 0xff) * factor));
  return `rgb(${r},${g},${b})`;
}

// ---------- NPC GENERATION ----------
const NPC_EMOJIS = ['🚶', '🚶‍♀️', '🐕', '🐈', '🚴', '🐦', '🤵', '👮', '🐩', '🚓', '🛴'];
function spawnNpcs() {
  elNpcs.innerHTML = '';
  elNpcs.style.width = WORLD_WIDTH + 'px';
  const npcCount = 34;
  for (let i = 0; i < npcCount; i++) {
    const n = document.createElement('div');
    n.className = 'npc';
    n.textContent = NPC_EMOJIS[Math.floor(Math.random() * NPC_EMOJIS.length)];
    n.dataset.x = Math.random() * WORLD_WIDTH;
    n.dataset.speed = (Math.random() * 0.4 + 0.1) * (Math.random() < 0.5 ? -1 : 1);
    n.dataset.bob = Math.random() * Math.PI * 2;
    elNpcs.appendChild(n);
  }
}

// ---------- INPUT ----------
const keys = {};
function setupInput() {
  document.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    keys[k] = true;
    if ([' ', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'w', 'a', 'd', 's', 'e'].includes(k)) {
      e.preventDefault();
    }
    const wasOutside = !state.interiorBuildingId;
    // Outside: W/Space/Up to enter building
    if (wasOutside && (k === 'w' || k === ' ' || k === 'arrowup')) {
      tryEnterBuilding();
    }
    // Inside: E only to use station (avoid same key triggering enter+use)
    if (!wasOutside && k === 'e') {
      tryUseStation();
    }
    // Escape: close modal or exit interior
    if (e.key === 'Escape') {
      if (!elModal.classList.contains('hidden')) {
        closeModal();
      } else if (state.interiorBuildingId) {
        exitInterior();
      }
    }
  });
  document.addEventListener('keyup', (e) => {
    keys[e.key.toLowerCase()] = false;
  });
}

// ---------- GAME LOOP ----------
let lastTime = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  if (!state.hasWon) {
    update(dt);
    render();
  }
  requestAnimationFrame(loop);
}

function update(dt) {
  const inputBlocked = !elModal.classList.contains('hidden');

  if (state.interiorBuildingId) {
    // ----- INTERIOR MOVEMENT -----
    const speed = 280;
    let move = 0;
    if (!inputBlocked) {
      if (keys['a'] || keys['arrowleft']) move -= 1;
      if (keys['d'] || keys['arrowright']) move += 1;
    }
    const def = BUILDING_INTERIORS[state.interiorBuildingId];
    state.interiorPlayerX += move * speed * dt;
    state.interiorPlayerX = clamp(state.interiorPlayerX, 80, def.width - 80);
    state.interiorWalking = move !== 0;
    if (move !== 0) state.interiorFacing = move;

    // Interior camera (only scrolls if room wider than viewport)
    const vw = window.innerWidth;
    if (def.width > vw) {
      const targetCam = state.interiorPlayerX - vw / 2;
      state.interiorCameraX += (targetCam - state.interiorCameraX) * Math.min(1, dt * 8);
      state.interiorCameraX = clamp(state.interiorCameraX, 0, def.width - vw);
    } else {
      state.interiorCameraX = 0;
    }
    updateStationProximity();
  } else {
    // ----- OVERWORLD MOVEMENT -----
    const speed = 240;
    let move = 0;
    if (!inputBlocked) {
      if (keys['a'] || keys['arrowleft']) move -= 1;
      if (keys['d'] || keys['arrowright']) move += 1;
    }
    state.playerWorldX += move * speed * dt;
    state.playerWorldX = clamp(state.playerWorldX, 60, WORLD_WIDTH - 100);
    state.walking = move !== 0;
    if (move !== 0) state.facing = move;

    const targetCam = state.playerWorldX - window.innerWidth / 2;
    state.cameraX += (targetCam - state.cameraX) * Math.min(1, dt * 8);
    state.cameraX = clamp(state.cameraX, 0, WORLD_WIDTH - window.innerWidth);

    updateBuildingProximity();
    updateNpcs(dt);
  }

  // Time progresses (each in-game day takes ~288 real seconds at IDLE_TIME_RATE=5)
  const gameMinThisFrame = dt * IDLE_TIME_RATE;
  state.timeMin += gameMinThisFrame;
  if (state.timeMin >= 1440) {
    state.timeMin = 6 * 60;
    state.day += 1;
    onNewDay();
  }

  // Passive stat decay — scales with career level (executive burnout) and sickness
  const careerStress = 1 + state.careerLevel * 0.06;
  const sickMult = state.sick > 0 ? 1.8 : 1.0;
  state.energy -= gameMinThisFrame * ENERGY_DRAIN * careerStress * sickMult;
  state.hunger -= gameMinThisFrame * HUNGER_DRAIN * sickMult;
  state.mood   -= gameMinThisFrame * MOOD_DRAIN_BASE * careerStress;

  state.energy = clamp(state.energy, 0, 100);
  state.hunger = clamp(state.hunger, 0, 100);
  state.mood   = clamp(state.mood, 0, 100);

  if (state.hunger < 5 && Math.random() < 0.005) state.mood -= 0.5;
  if (state.energy < 5 && Math.random() < 0.005) state.mood -= 0.5;

  // Investment passive growth (~4% per real minute)
  if (state.investments > 0) {
    state.investments += state.investments * 0.0007 * dt;
  }

  // Stock prices drift (random walk) — volatility grows with day (boom & bust eras)
  const vol = 0.6 * (1 + state.day * 0.03);
  for (const k of ['frank', 'bun', 'kraft']) {
    const drift = (Math.random() - 0.48) * vol;
    state.stockPrices[k] = clamp(state.stockPrices[k] + drift, 30, 8000);
  }

  // Factory passive income
  if (state.factoryOwned && state.factoryAutomation > 0) {
    state.factoryAccumulated += state.factoryAutomation * 1.5 * dt;
  }
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function render() {
  // Overworld
  elCity.style.transform = `translateX(${-state.cameraX}px)`;
  elNpcs.style.transform = `translateX(${-state.cameraX}px)`;
  elPlayer.style.left = (state.playerWorldX - state.cameraX) + 'px';
  elPlayer.style.transform = 'translateX(-50%)';
  elPlayer.classList.toggle('facing-left', state.facing < 0);
  elPlayer.classList.toggle('walking', state.walking);

  // Interior
  if (state.interiorBuildingId) {
    elBackWall.style.transform = `translateZ(-200px) translateX(${-state.interiorCameraX}px)`;
    elFloor3d.style.transform = `translateZ(-200px) translateX(${-state.interiorCameraX}px) rotateX(72deg)`;
    elStations.style.transform = `translateX(${-state.interiorCameraX}px)`;
    elInteriorPlayer.style.left = (state.interiorPlayerX - state.interiorCameraX) + 'px';
    elInteriorPlayer.classList.toggle('facing-left', state.interiorFacing < 0);
    elInteriorPlayer.classList.toggle('walking', state.interiorWalking);
  }

  renderHUD();

  // Day/night visuals
  const hour = state.timeMin / 60;
  let mode = 'day';
  if (hour < 6 || hour >= 20) mode = 'night';
  else if (hour >= 17) mode = 'evening';
  elWorld.classList.toggle('night', mode === 'night');
  elWorld.classList.toggle('evening', mode === 'evening');
}

function renderHUD() {
  $('money').textContent = Math.floor(state.money).toLocaleString();
  setBar('energyBar', state.energy);
  setBar('hungerBar', state.hunger);
  setBar('moodBar', state.mood);

  const career = CAREERS[state.careerLevel];
  $('careerTitle').textContent = career.title;
  $('careerLevel').textContent = 'Lvl ' + (state.careerLevel + 1);
  const next = career.xpToNext;
  const prev = state.careerLevel > 0 ? CAREERS[state.careerLevel - 1].xpToNext : 0;
  const pct = next === Infinity ? 100 : ((state.xp - prev) / (next - prev)) * 100;
  $('xpBar').style.width = clamp(pct, 0, 100) + '%';

  $('dayCount').textContent = 'Day ' + state.day;
  const hr = Math.floor(state.timeMin / 60);
  const min = Math.floor(state.timeMin % 60);
  const ampm = hr >= 12 ? 'PM' : 'AM';
  const h12 = ((hr + 11) % 12) + 1;
  let icon = '☀️';
  if (hr < 6 || hr >= 20) icon = '🌙';
  else if (hr < 11) icon = '🌅';
  else if (hr >= 17) icon = '🌇';
  $('timeOfDay').textContent = `${icon} ${h12}:${min.toString().padStart(2,'0')} ${ampm}`;

  // Goal progress
  const goalEl = $('goalText');
  if (goalEl) {
    const nw = networth();
    const reachedLvl = state.careerLevel >= 9;
    const reachedNw = nw >= WIN_NET_WORTH;
    if (reachedLvl && reachedNw) {
      goalEl.textContent = '🏆 Visit the Tower to WIN!';
      goalEl.classList.add('met');
    } else if (reachedLvl) {
      goalEl.textContent = `🎯 Net Worth: $${Math.floor(nw).toLocaleString()} / $${WIN_NET_WORTH.toLocaleString()}`;
      goalEl.classList.remove('met');
    } else {
      const lvlsLeft = 9 - state.careerLevel;
      goalEl.textContent = `🎯 Goal: Hot Dog Mogul (${lvlsLeft} promo${lvlsLeft===1?'':'s'} away) + $${WIN_NET_WORTH.toLocaleString()}`;
      goalEl.classList.remove('met');
    }
  }
}

function setBar(id, val) {
  const el = $(id);
  el.style.width = val + '%';
  el.classList.toggle('warn', val < 20);
}

// ---------- BUILDING PROXIMITY ----------
let nearestBuilding = null;
function updateBuildingProximity() {
  let near = null;
  let bestDist = 130;
  BUILDING_DEFS.forEach(def => {
    const w = 140 + (def.windows[0] * 8);
    const cx = def.x + w / 2;
    const d = Math.abs(cx - state.playerWorldX);
    if (d < bestDist) {
      bestDist = d;
      near = def;
    }
  });

  if (near !== nearestBuilding) {
    document.querySelectorAll('.building.near').forEach(b => b.classList.remove('near'));
    if (near) {
      const el = document.querySelector(`.building[data-id="${near.id}"]`);
      if (el) el.classList.add('near');
    }
    nearestBuilding = near;
  }

  elEnterPrompt.classList.toggle('hidden', !near || !!state.interiorBuildingId);
}

function tryEnterBuilding() {
  if (!nearestBuilding) return;
  if (BUILDING_INTERIORS[nearestBuilding.id]) {
    enterInterior(nearestBuilding.id);
  }
}

// ---------- NPCs ----------
function updateNpcs(dt) {
  document.querySelectorAll('.npc').forEach(n => {
    let x = parseFloat(n.dataset.x);
    let speed = parseFloat(n.dataset.speed);
    let bob = parseFloat(n.dataset.bob);
    x += speed * dt * 60;
    bob += dt * 8;
    if (x < -100) x = WORLD_WIDTH + 100;
    if (x > WORLD_WIDTH + 100) x = -100;
    n.dataset.x = x;
    n.dataset.bob = bob;
    n.style.left = x + 'px';
    n.style.transform = `translateY(${Math.sin(bob) * 3}px) scaleX(${speed > 0 ? 1 : -1})`;
  });
}

// ---------- BUILDING INTERACTIONS (modal-only popups) ----------
function closeModal() {
  elModal.classList.add('hidden');
}

function showModal(html) {
  elModalBody.innerHTML = html;
  elModal.classList.remove('hidden');
  elModalBody.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => handleAction(btn.dataset.action, btn));
  });
}

// ---------- 3D INTERIOR SYSTEM ----------
let nearestStation = null;
let currentStations = [];

function enterInterior(buildingId) {
  const def = BUILDING_INTERIORS[buildingId];
  if (!def) return;
  state.interiorBuildingId = buildingId;
  state.interiorPlayerX = 150;
  state.interiorCameraX = 0;
  state.interiorFacing = 1;
  nearestStation = null;

  // Apply theme
  elInteriorRoom.className = 'interior-room theme-' + def.theme;
  // Set room widths for backdrop & floor
  elBackWall.style.width = def.width + 'px';
  elFloor3d.style.width = def.width + 'px';
  elStations.style.width = def.width + 'px';

  // Title + decor
  elInteriorTitle.textContent = def.icon + '  ' + def.name;
  elInteriorSubtitle.textContent = def.subtitle;
  elWallDecor.innerHTML = def.decor.map(d => `<span>${d}</span>`).join('');

  // Refresh outfit on interior player too
  renderOutfit();

  // Stations
  refreshInterior();

  // Show
  elInterior.classList.remove('hidden');
}

function exitInterior() {
  state.interiorBuildingId = null;
  nearestStation = null;
  currentStations = [];
  elInterior.classList.add('hidden');
}

function refreshInterior() {
  if (!state.interiorBuildingId) return;
  const def = BUILDING_INTERIORS[state.interiorBuildingId];
  currentStations = def.stations();
  elStations.innerHTML = currentStations.map((s, i) => `
    <div class="station-3d ${s.disable ? 'disabled' : ''}" data-idx="${i}" style="left: ${s.x}px;">
      ${s.price ? `<div class="station-price ${s.priceClass || ''}">${s.price}</div>` : ''}
      <div class="station-icon">${s.icon}</div>
      <div class="station-pedestal"></div>
      <div class="station-label">${s.label}</div>
    </div>
  `).join('');
  // Click handlers
  elStations.querySelectorAll('.station-3d').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.idx);
      const s = currentStations[idx];
      if (!s || s.disable) return;
      handleAction(s.action);
    });
  });
}

function updateStationProximity() {
  if (!state.interiorBuildingId) return;
  let near = null;
  let bestDist = 80;
  let nearIdx = -1;
  currentStations.forEach((s, i) => {
    if (s.disable) return;
    const d = Math.abs(s.x - state.interiorPlayerX);
    if (d < bestDist) {
      bestDist = d;
      near = s;
      nearIdx = i;
    }
  });

  if (near !== nearestStation) {
    elStations.querySelectorAll('.station-3d').forEach(el => el.classList.remove('near'));
    if (nearIdx >= 0) {
      const el = elStations.querySelector(`.station-3d[data-idx="${nearIdx}"]`);
      if (el) el.classList.add('near');
    }
    nearestStation = near;
  }

  if (near) {
    elInteriorPrompt.classList.remove('hidden');
    elInteriorPrompt.style.left = (near.x - state.interiorCameraX) + 'px';
    elInteriorPrompt.innerHTML = `Press <kbd>E</kbd> ${near.label}`;
  } else {
    elInteriorPrompt.classList.add('hidden');
  }
}

function tryUseStation() {
  if (!nearestStation || nearestStation.disable) return;
  handleAction(nearestStation.action);
}

// ---------- ACTIONS ----------
function handleAction(action, btn) {
  switch (action) {
    case 'sleep_short':
      advanceTime(60);
      changeStat('energy', 30);
      changeStat('hunger', -10);
      notify('You took a quick nap. Refreshed!', 'good');
      reopenCurrent();
      break;
    case 'sleep_long':
      const restMin = state.timeMin > 6*60 ? (24*60 - state.timeMin) + 6*60 : (6*60 - state.timeMin);
      advanceTime(restMin);
      state.energy = 100;
      changeStat('hunger', -25);
      changeStat('mood', state.ownsApartment ? 25 : 10);
      notify('You slept like a log. New day!', 'good');
      reopenCurrent();
      break;
    case 'tv':
      advanceTime(60);
      changeStat('mood', 15);
      changeStat('energy', -10);
      notify('Caught up on Sausage News Network.', 'good');
      reopenCurrent();
      break;
    case 'buy_apartment':
      if (!spend(2000)) return;
      state.ownsApartment = true;
      notify('You upgraded to a penthouse! 🏙️', 'epic');
      reopenCurrent();
      break;

    case 'buy_cart':
      if (!spend(50)) return;
      state.ownsCart = true;
      notify('You bought the cart! Time to hustle.', 'epic');
      reopenCurrent();
      break;
    case 'start_vendor':
      state.careerLevel = 1;
      state.outfit = CAREERS[1].outfit;
      renderOutfit();
      notify('You are now a Street Cart Vendor! 🌭', 'epic');
      gainXp(5);
      reopenCurrent();
      break;
    case 'work_cart':
      if (state.energy < 10) {
        notify('Too tired! Get some rest first.', 'bad');
        return;
      }
      advanceTime(60);
      const cartE = cartPay();
      earn(cartE);
      changeStat('energy', -15);
      changeStat('hunger', -10);
      gainXp(8, 'cart');
      notify(`Sold hot dogs! +$${cartE}`, 'good');
      spawnParticle(`+$${cartE}`, 'gain');
      reopenCurrent();
      break;
    case 'eat_dog':
      if (!spend(3)) return;
      changeStat('hunger', 25);
      changeStat('mood', -2);
      notify('You ate one of your own kind. Yum?', 'bad');
      reopenCurrent();
      break;

    case 'apply_job':
      state.hasJob = true;
      state.careerLevel = 2;
      state.outfit = CAREERS[2].outfit;
      renderOutfit();
      notify('You got the internship! Welcome to corporate.', 'epic');
      gainXp(10);
      reopenCurrent();
      break;
    case 'work_office':
      if (state.energy < 15) {
        notify('You\'re falling asleep at your desk. Rest!', 'bad');
        return;
      }
      advanceTime(120);
      const pay = jobPay();
      earn(pay);
      changeStat('energy', -25);
      changeStat('hunger', -15);
      changeStat('mood', -8);
      gainXp(20, 'office');
      notify(`Worked hard. Earned $${pay}.`, 'good');
      spawnParticle(`+$${pay}`, 'gain');
      reopenCurrent();
      break;
    case 'try_promote':
      const need = CAREERS[state.careerLevel].xpToNext;
      if (state.xp >= need && state.careerLevel < CAREERS.length - 1) {
        state.careerLevel += 1;
        state.outfit = CAREERS[state.careerLevel].outfit;
        renderOutfit();
        notify(`PROMOTED to ${CAREERS[state.careerLevel].title}! 🎉`, 'epic');
        spawnConfetti();
      }
      reopenCurrent();
      break;
    case 'meeting':
      advanceTime(60);
      changeStat('mood', -10);
      gainXp(10, 'meeting');
      notify('That meeting could have been an email.', 'bad');
      reopenCurrent();
      break;

    case 'eat_snack':
      if (!spend(5)) return;
      changeStat('hunger', 15);
      reopenCurrent();
      break;
    case 'eat_meal':
      if (!spend(15)) return;
      changeStat('hunger', 45);
      changeStat('mood', 10);
      notify('That hit the spot.', 'good');
      reopenCurrent();
      break;
    case 'eat_feast':
      if (!spend(45)) return;
      changeStat('hunger', 80);
      changeStat('mood', 25);
      notify('Bougie steak dinner. Living large.', 'good');
      reopenCurrent();
      break;

    case 'workout':
      if (!spend(10)) return;
      advanceTime(60);
      changeStat('energy', 15);
      changeStat('mood', 5);
      changeStat('hunger', -15);
      gainXp(5, 'workout');
      notify('Buns of steel acquired.', 'good');
      reopenCurrent();
      break;
    case 'sauna':
      if (!spend(8)) return;
      advanceTime(45);
      changeStat('mood', 30);
      changeStat('hunger', -10);
      reopenCurrent();
      break;

    case 'walk_park':
      advanceTime(30);
      changeStat('mood', 15);
      changeStat('energy', -5);
      reopenCurrent();
      break;
    case 'feed_birds':
      if (!spend(2)) return;
      changeStat('mood', 25);
      reopenCurrent();
      break;
    case 'beg':
      const begAmt = Math.floor(2 + Math.random() * 4);
      earn(begAmt);
      changeStat('mood', -8);
      notify(`Got $${begAmt} in pity change.`, 'bad');
      reopenCurrent();
      break;

    case 'invest_100':
      if (!spend(100)) return;
      state.investments += 100;
      notify('Invested $100. Compound interest is magic.', 'good');
      reopenCurrent();
      break;
    case 'invest_1000':
      if (!spend(1000)) return;
      state.investments += 1000;
      notify('Invested $1,000. Big money moves.', 'epic');
      reopenCurrent();
      break;
    case 'withdraw_all':
      const w = Math.floor(state.investments);
      earn(w);
      state.investments = 0;
      notify(`Cashed out $${w}!`, 'epic');
      reopenCurrent();
      break;

    case 'buy_tie':
      if (!spend(50)) return;
      state.outfit = 'tie';
      renderOutfit();
      notify('Looking sharp.', 'good');
      reopenCurrent();
      break;
    case 'buy_suit':
      if (!spend(300)) return;
      state.outfit = 'suit';
      renderOutfit();
      notify('Power moves only.', 'good');
      reopenCurrent();
      break;
    case 'buy_tux':
      if (!spend(1200)) return;
      state.outfit = 'tux';
      renderOutfit();
      notify('007 vibes. Bond. Hot Dog Bond.', 'epic');
      reopenCurrent();
      break;
    case 'buy_ceo':
      if (!spend(5000)) return;
      state.outfit = 'ceo';
      renderOutfit();
      notify('CEO ensemble equipped. The city knows your name.', 'epic');
      reopenCurrent();
      break;

    case 'drink_beer':
      if (!spend(8)) return;
      advanceTime(45);
      changeStat('mood', 20);
      changeStat('energy', -5);
      reopenCurrent();
      break;
    case 'network':
      if (!spend(25)) return;
      advanceTime(90);
      gainXp(15, 'network');
      changeStat('mood', 10);
      notify('Made a connection. Could be useful.', 'good');
      reopenCurrent();
      break;
    case 'karaoke':
      if (!spend(5)) return;
      advanceTime(60);
      changeStat('mood', 40);
      notify('You crushed "Sweet Caroline" 🎤', 'epic');
      reopenCurrent();
      break;

    case 'win':
      doWin();
      break;
    case 'leave':
      closeModal();
      exitInterior();
      break;

    // ----- NEW: DINER -----
    case 'eat_cake':
      if (!spend(25)) return;
      changeStat('hunger', 30);
      changeStat('mood', 35);
      notify('🎂 You celebrated... yourself. Why not.', 'good');
      reopenCurrent();
      break;

    // ----- NEW: GYM -----
    case 'cardio':
      if (!spend(8)) return;
      advanceTime(45);
      changeStat('energy', 10);
      changeStat('hunger', -10);
      gainXp(4, 'cardio');
      notify('Your bun is now tighter than your schedule.', 'good');
      reopenCurrent();
      break;
    case 'yoga':
      if (!spend(12)) return;
      advanceTime(60);
      changeStat('mood', 25);
      changeStat('energy', 5);
      notify('Namaste, frankfurter.', 'good');
      reopenCurrent();
      break;

    // ----- NEW: PARK -----
    case 'sell_art':
      const art = 5 + state.careerLevel * 2 + Math.floor(Math.random() * 8);
      earn(art);
      changeStat('mood', 8);
      gainXp(3, 'art');
      notify(`Sold a painting for $${art}!`, 'good');
      spawnParticle(`+$${art}`, 'gain');
      reopenCurrent();
      break;

    // ----- NEW: OFFICE -----
    case 'coffee':
      if (!spend(5)) return;
      changeStat('energy', 25);
      changeStat('mood', 5);
      notify('☕ Caffeine acquired. Productivity unlocked.', 'good');
      reopenCurrent();
      break;

    // ----- NEW: BANK -----
    case 'invest_10k':
      if (!spend(10000)) return;
      state.investments += 10000;
      notify('Invested $10,000! Compound interest, baby.', 'epic');
      reopenCurrent();
      break;

    // ----- NEW: BAR -----
    case 'wine':
      if (!spend(50)) return;
      advanceTime(60);
      changeStat('mood', 35);
      gainXp(5);
      notify('Bouquet of mustard, hints of relish. Lovely.', 'good');
      reopenCurrent();
      break;

    // ----- NEW: UNIVERSITY -----
    case 'take_class':
      if (!spend(100)) return;
      advanceTime(120);
      gainXp(50);
      changeStat('energy', -15);
      changeStat('mood', -5);
      if (state.educationLevel < 1) state.educationLevel = 1;
      notify('📚 Class completed! +50 XP', 'good');
      reopenCurrent();
      break;
    case 'mba':
      if (state.educationLevel >= 2) { reopenCurrent(); return; }
      if (!spend(1500)) return;
      advanceTime(180);
      gainXp(200);
      state.educationLevel = 2;
      changeStat('energy', -30);
      notify('🎓 MBA earned! Your career is supercharged.', 'epic');
      spawnConfetti();
      reopenCurrent();
      break;
    case 'research':
      if (!spend(300)) return;
      advanceTime(120);
      gainXp(100, 'research');
      changeStat('energy', -25);
      notify('Published a paper on bun structural integrity!', 'good');
      reopenCurrent();
      break;
    case 'study':
      advanceTime(60);
      gainXp(15, 'study');
      changeStat('energy', -10);
      notify('Quiet study time. +15 XP', 'good');
      reopenCurrent();
      break;

    // ----- NEW: HOSPITAL -----
    case 'checkup':
      if (!spend(50)) return;
      advanceTime(45);
      changeStat('energy', 20);
      changeStat('mood', 10);
      state.sick = 0;
      notify('Doc says you\'re in great shape!', 'good');
      reopenCurrent();
      break;
    case 'medicine':
      if (!spend(80)) return;
      changeStat('energy', 30);
      state.sick = 0;
      notify('💊 Feeling better already.', 'good');
      reopenCurrent();
      break;
    case 'full_treatment':
      if (!spend(300)) return;
      advanceTime(120);
      state.energy = 100;
      state.hunger = 100;
      changeStat('mood', 30);
      state.sick = 0;
      notify('🚑 Fully restored! Worth every penny.', 'epic');
      reopenCurrent();
      break;
    case 'booster':
      if (!spend(120)) return;
      changeStat('energy', 50);
      changeStat('mood', 10);
      notify('💉 Energy through the roof!', 'good');
      reopenCurrent();
      break;

    // ----- NEW: CASINO -----
    case 'slots': {
      if (!spend(10)) return;
      advanceTime(15);
      const r = Math.random();
      let win = 0;
      if (r < 0.55) win = 0;
      else if (r < 0.85) win = 15;
      else if (r < 0.97) win = 50;
      else win = 200;
      if (win > 0) { earn(win); spawnParticle(`+$${win}`, 'gain'); notify(`🎰 SLOTS! Won $${win}`, 'good'); }
      else { notify('🎰 Slots... lost. House edge!', 'bad'); }
      reopenCurrent();
      break;
    }
    case 'blackjack': {
      if (!spend(50)) return;
      advanceTime(20);
      const r = Math.random();
      let win = 0;
      if (r < 0.45) win = 0;
      else if (r < 0.85) win = 100;
      else win = 250;
      if (win > 0) { earn(win); spawnParticle(`+$${win}`, 'gain'); notify(`🃏 21! Won $${win}`, 'good'); }
      else { notify('🃏 Bust. Lost $50.', 'bad'); }
      reopenCurrent();
      break;
    }
    case 'roulette': {
      if (!spend(100)) return;
      advanceTime(20);
      const r = Math.random();
      let win = 0;
      if (r < 0.50) win = 0;
      else if (r < 0.92) win = 200;
      else win = 700;
      if (win > 0) { earn(win); spawnParticle(`+$${win}`, 'gain'); notify(`🎲 Roulette! Won $${win}`, 'good'); }
      else { notify('🎲 Wheel went the wrong way.', 'bad'); }
      reopenCurrent();
      break;
    }
    case 'high_roller': {
      if (!spend(1000)) return;
      advanceTime(30);
      const r = Math.random();
      let win = 0;
      if (r < 0.55) win = 0;
      else if (r < 0.90) win = 2200;
      else win = 8000;
      if (win > 0) { earn(win); spawnParticle(`+$${win}`, 'epic'); notify(`💎 HIGH ROLLER WIN! +$${win}`, 'epic'); spawnConfetti(); }
      else { notify('💎 High Roller... high losses. -$1,000', 'bad'); }
      reopenCurrent();
      break;
    }

    // ----- NEW: STOCKS -----
    case 'buy_frank': buyStock('frank'); break;
    case 'buy_bun':   buyStock('bun');   break;
    case 'buy_kraft': buyStock('kraft'); break;
    case 'sell_stocks': {
      const total = Math.floor(stockPortfolioValue());
      if (total <= 0) { reopenCurrent(); return; }
      earn(total);
      state.stockShares = { frank: 0, bun: 0, kraft: 0 };
      spawnParticle(`+$${total}`, 'epic');
      notify(`📈 Sold all stocks for $${total.toLocaleString()}!`, 'epic');
      reopenCurrent();
      break;
    }

    // ----- NEW: FACTORY -----
    case 'buy_factory':
      if (!spend(8000)) return;
      state.factoryOwned = true;
      notify('🏭 You bought the Hot Dog Factory! Time to scale.', 'epic');
      spawnConfetti();
      reopenCurrent();
      break;
    case 'factory_shift': {
      if (state.energy < 20) { notify('Too tired for factory work!', 'bad'); return; }
      advanceTime(180);
      const pay = factoryShiftPay();
      earn(pay);
      changeStat('energy', -30);
      changeStat('hunger', -20);
      gainXp(25, 'factory_shift');
      notify(`Ran a shift. Earned $${pay}.`, 'good');
      spawnParticle(`+$${pay}`, 'gain');
      reopenCurrent();
      break;
    }
    case 'factory_collect': {
      const amt = Math.floor(state.factoryAccumulated);
      if (amt < 1) { reopenCurrent(); return; }
      earn(amt);
      state.factoryAccumulated = 0;
      spawnParticle(`+$${amt}`, 'gain');
      notify(`Collected $${amt} in passive income!`, 'good');
      reopenCurrent();
      break;
    }
    case 'upgrade_automation': {
      if (state.factoryAutomation >= 3) { reopenCurrent(); return; }
      const cost = 5000 * (state.factoryAutomation + 1);
      if (!spend(cost)) return;
      state.factoryAutomation += 1;
      notify(`🤖 Automation Lvl ${state.factoryAutomation}! Passive income increased.`, 'epic');
      spawnConfetti();
      reopenCurrent();
      break;
    }
    case 'big_deal': {
      if (!spend(2000)) return;
      advanceTime(60);
      const profit = 4000 + Math.floor(Math.random() * 4000);
      earn(profit);
      gainXp(30, 'big_deal');
      notify(`🚛 Sealed a $${profit} distribution deal!`, 'epic');
      spawnParticle(`+$${profit}`, 'epic');
      reopenCurrent();
      break;
    }

    // ----- NEW: MANSION -----
    case 'buy_mansion':
      if (!spend(25000)) return;
      state.ownsMansion = true;
      notify('🏰 You bought the Wiener Mansion!', 'epic');
      spawnConfetti();
      reopenCurrent();
      break;
    case 'mansion_sleep': {
      const restMin = state.timeMin > 6*60 ? (24*60 - state.timeMin) + 6*60 : (6*60 - state.timeMin);
      advanceTime(restMin);
      state.energy = 100;
      changeStat('mood', 40);
      notify('Slept like royalty. Woke up powerful.', 'epic');
      reopenCurrent();
      break;
    }
    case 'pool':
      advanceTime(60);
      changeStat('mood', 35);
      changeStat('energy', 10);
      notify('🏊 Refreshing dip. The good life.', 'good');
      reopenCurrent();
      break;
    case 'wine_cellar':
      advanceTime(45);
      changeStat('mood', 30);
      gainXp(5);
      notify('🍷 You sampled vintage relish wine.', 'good');
      reopenCurrent();
      break;
    case 'party':
      if (!spend(1000)) return;
      advanceTime(180);
      changeStat('mood', 60);
      gainXp(40, 'party');
      notify('🥂 Threw the party of the year!', 'epic');
      spawnConfetti();
      reopenCurrent();
      break;

    // ----- EXPANDED CITY: BAKERY / SUBWAY / THEATER / ARCADE / HOTEL / TRUCK / MUSEUM / AIRPORT -----
    case 'bakery_muffin':
      if (!spend(4)) return;
      changeStat('hunger', 28);
      changeStat('mood', 6);
      notify('🧁 Warm muffin hits different.', 'good');
      reopenCurrent();
      break;
    case 'bakery_latte':
      if (!spend(7)) return;
      changeStat('energy', 18);
      changeStat('hunger', 8);
      notify('☕ Latte art shaped like a wiener. Cute.', 'good');
      reopenCurrent();
      break;
    case 'bakery_cronut':
      if (!spend(18)) return;
      changeStat('hunger', 40);
      changeStat('mood', 14);
      notify('🥨 Cronut achieved. Society may proceed.', 'good');
      reopenCurrent();
      break;

    case 'subway_ride':
      if (!spend(3)) return;
      advanceTime(45);
      changeStat('mood', 10);
      changeStat('energy', -6);
      notify('🚇 You rode the express. Still somehow late.', 'good');
      reopenCurrent();
      break;
    case 'subway_busker':
      if (!spend(5)) return;
      changeStat('mood', 14);
      gainXp(4, 'subway_busker');
      notify('🎸 You tipped a busker. Good karma pending.', 'good');
      reopenCurrent();
      break;

    case 'theater_movie':
      if (!spend(35)) return;
      advanceTime(120);
      changeStat('mood', 30);
      changeStat('hunger', -8);
      notify('🎬 Matinee: loud chewing from Row F.', 'good');
      reopenCurrent();
      break;
    case 'theater_broadway':
      if (!spend(120)) return;
      advanceTime(180);
      changeStat('mood', 48);
      gainXp(22, 'theater_broadway');
      notify('🎭 Broadway night. You wept during the mustard solo.', 'epic');
      reopenCurrent();
      break;

    case 'arcade_ticket':
      if (!spend(15)) return;
      {
        const roll = Math.random();
        if (roll < 0.22) {
          earn(40);
          notify('👾 JACKPOT TICKETS!', 'epic');
          spawnParticle('+$40', 'gain');
        } else if (roll < 0.55) {
          earn(12);
          notify('👾 Decent haul.', 'good');
          spawnParticle('+$12', 'gain');
        } else {
          notify('👾 The house claims another victim.', 'bad');
        }
      }
      reopenCurrent();
      break;
    case 'arcade_highscore':
      if (!spend(50)) return;
      changeStat('mood', 22);
      gainXp(10, 'arcade_hi');
      notify('🏆 New high score — mentally, if not on the machine.', 'good');
      reopenCurrent();
      break;

    case 'hotel_nap':
      if (!spend(45)) return;
      advanceTime(90);
      changeStat('energy', 45);
      changeStat('hunger', -12);
      notify('🛏️ Hotel nap: you forgot what year it is.', 'good');
      reopenCurrent();
      break;
    case 'hotel_gala':
      if (!spend(200)) return;
      advanceTime(120);
      changeStat('mood', 38);
      gainXp(35, 'hotel_gala');
      notify('🍾 Gala networking: handed out 40 business buns.', 'epic');
      reopenCurrent();
      break;
    case 'hotel_brunch':
      if (!spend(65)) return;
      changeStat('hunger', 45);
      changeStat('mood', 18);
      notify('🥐 Brunch buffet. Third plate was legally necessary.', 'good');
      reopenCurrent();
      break;

    case 'truck_shift':
      if (state.energy < 12) {
        notify('Too tired to run the truck!', 'bad');
        return;
      }
      advanceTime(90);
      const tp = truckPay();
      earn(tp);
      changeStat('energy', -18);
      changeStat('hunger', -12);
      gainXp(12, 'truck');
      notify(`🚚 Truck shift done! +$${tp}`, 'good');
      spawnParticle(`+$${tp}`, 'gain');
      reopenCurrent();
      break;
    case 'truck_sample':
      if (!spend(6)) return;
      changeStat('hunger', 18);
      changeStat('mood', 8);
      notify('🌭 Chef\'s special — secret is hope.', 'good');
      reopenCurrent();
      break;

    case 'museum_day':
      if (!spend(25)) return;
      advanceTime(90);
      changeStat('mood', 18);
      gainXp(14, 'museum');
      notify('🖼️ Stared at oil paintings of condiments.', 'good');
      reopenCurrent();
      break;
    case 'museum_gala':
      if (!spend(150)) return;
      advanceTime(120);
      changeStat('mood', 28);
      gainXp(42, 'museum_gala');
      notify('🥂 Donor gala: you clapped at modern relish.', 'epic');
      reopenCurrent();
      break;

    case 'airport_shuttle':
      if (!spend(400)) return;
      advanceTime(240);
      changeStat('mood', 22);
      changeStat('energy', -15);
      gainXp(55, 'air_shuttle');
      notify('🛫 Shuttle flight: you closed deals from seat 14B.', 'epic');
      reopenCurrent();
      break;
    case 'airport_redeye':
      if (!spend(1500)) return;
      advanceTime(360);
      changeStat('energy', -22);
      changeStat('mood', 18);
      gainXp(120, 'air_redeye');
      notify('🌙 Red-eye deal trip. Your soul is carry-on only.', 'epic');
      reopenCurrent();
      break;

    case 'butler':
      if (!spend(2000)) return;
      changeStat('mood', 25);
      state.energy = 100;
      state.hunger = 100;
      notify('🎺 Jeeves restored your stats. Splendid.', 'epic');
      reopenCurrent();
      break;
  }
}

function reopenCurrent() {
  if (state.interiorBuildingId) refreshInterior();
}

// ---------- HELPERS ----------
function spend(n) {
  if (state.money < n) {
    notify("You're broke! Can't afford that.", 'bad');
    return false;
  }
  state.money -= n;
  spawnParticle(`-$${n}`, 'loss');
  return true;
}

function earn(n) {
  state.money += n;
  state.totalEarned += n;
}

function changeStat(stat, delta) {
  state[stat] = clamp(state[stat] + delta, 0, 100);
}

// gainXp(amount, key) — `key` enables daily diminishing returns per action type
// (forces variety: spamming the same action gives less and less XP each repeat that day).
function gainXp(amt, key) {
  // Education boosts XP gain
  const eduBonus = 1 + state.educationLevel * 0.25;

  // Daily fatigue per action key
  let fatigueBonus = 1;
  if (key) {
    const reps = state.xpFatigue[key] || 0;
    fatigueBonus = Math.pow(XP_FATIGUE, reps);
    state.xpFatigue[key] = reps + 1;
    // Floor at 25% so it's never useless
    if (fatigueBonus < 0.25) fatigueBonus = 0.25;
  }

  // Stat penalties — low mood / sickness reduce learning
  let statMult = 1;
  if (state.mood < 30) statMult *= 0.7;
  if (state.sick > 0) statMult *= 0.6;

  state.xp += amt * eduBonus * fatigueBonus * statMult;

  while (state.careerLevel < CAREERS.length - 1 && state.xp >= CAREERS[state.careerLevel].xpToNext) {
    if (state.careerLevel === 1 && !state.hasJob) break;
    state.careerLevel += 1;
    state.outfit = CAREERS[state.careerLevel].outfit;
    renderOutfit();
    notify(`PROMOTED to ${CAREERS[state.careerLevel].title}! 🎉`, 'epic');
    spawnConfetti();
  }
}

function cartPay() {
  return Math.floor(8 + Math.random() * 6 + state.careerLevel * 2);
}

function truckPay() {
  return Math.floor(12 + Math.random() * 10 + state.careerLevel * 3);
}

function jobPay() {
  const c = CAREERS[state.careerLevel];
  const eduMultiplier = 1 + state.educationLevel * 0.15;
  return Math.floor(c.pay * (0.85 + Math.random() * 0.3) * eduMultiplier);
}

function factoryShiftPay() {
  return Math.floor(150 + state.careerLevel * 30 + state.factoryAutomation * 50 + Math.random() * 100);
}

function stockPortfolioValue() {
  return state.stockShares.frank * state.stockPrices.frank
    + state.stockShares.bun   * state.stockPrices.bun
    + state.stockShares.kraft * state.stockPrices.kraft;
}

function buyStock(key) {
  const price = Math.floor(state.stockPrices[key]);
  if (!spend(price)) return;
  state.stockShares[key] += 1;
  // Buying causes a small price bump
  state.stockPrices[key] *= 1.02;
  notify(`Bought 1 ${key.toUpperCase()} share at $${price}.`, 'good');
  reopenCurrent();
}

function advanceTime(minutes) {
  state.timeMin += minutes;
  while (state.timeMin >= 1440) {
    state.timeMin -= 1440;
    state.day += 1;
    onNewDay();
  }
}

function onNewDay() {
  // Reset XP fatigue (variety bonus refreshes daily)
  state.xpFatigue = {};

  // Inflation factor (everything gets more expensive over time)
  const inflation = 1 + state.day * INFLATION_PER_DAY;

  // Daily rent
  const baseRent = state.ownsMansion ? 800 : (state.ownsApartment ? 120 : 25);
  const rent = Math.floor(baseRent * inflation);
  if (state.money >= rent) {
    state.money -= rent;
    notify(`💸 Daily rent: -$${rent}` + (inflation > 1.2 ? ' (inflation!)' : ''), 'bad');
  } else {
    state.mood -= 20;
    notify(`Couldn't pay rent! Mood crashed. (-$${rent} owed)`, 'bad');
  }

  // Factory upkeep — automation costs more
  if (state.factoryOwned) {
    const upkeep = Math.floor((40 + state.factoryAutomation * 60) * inflation);
    if (state.money >= upkeep) {
      state.money -= upkeep;
      notify(`🏭 Factory upkeep: -$${upkeep}`, 'bad');
    } else {
      state.factoryAutomation = Math.max(0, state.factoryAutomation - 1);
      notify(`Couldn't pay factory upkeep! Automation degraded.`, 'bad');
    }
  }

  // Brokerage fees on stocks (small but adds up at scale)
  const sharesOwned = state.stockShares.frank + state.stockShares.bun + state.stockShares.kraft;
  if (sharesOwned > 0) {
    const fee = Math.floor(sharesOwned * 2 * inflation);
    state.money = Math.max(0, state.money - fee);
    if (fee >= 10) notify(`📊 Brokerage fees: -$${fee}`, 'bad');
  }

  // Sickness ticks down (and degrades stats while sick)
  if (state.sick > 0) {
    state.sick -= 1;
    state.sickStreak += 1;
    if (state.sick === 0) {
      notify(`🤧 You\'ve recovered.`, 'good');
    } else {
      changeStat('energy', -15);
      changeStat('mood', -10);
      notify(`🤒 Still sick (${state.sick}d remaining).`, 'bad');
    }
  }

  // Random event chance grows with day, capped at 80%
  const eventChance = Math.min(0.80, 0.45 + state.day * 0.015);
  if (Math.random() < eventChance) randomEvent();
}

// Difficulty multiplier scales with day and career level (richer = bigger targets)
function diffMult() { return 1 + state.day * 0.04 + state.careerLevel * 0.08; }

const EVENTS = [
  { msg: () => { const a = Math.floor(20 * diffMult()); return `You found $${a} on the sidewalk!`; },
    do: () => { const a = Math.floor(20 * diffMult()); earn(a); spawnParticle(`+$${a}`, 'gain'); }, type: 'good' },
  { msg: () => `A pigeon stole your wallet. -$${Math.floor(15 * diffMult())}`,
    do: () => { const a = Math.floor(15 * diffMult()); state.money = Math.max(0, state.money - a); spawnParticle(`-$${a}`, 'loss'); }, type: 'bad' },
  { msg: 'A child smiled at you. Mood boosted!',
    do: () => { changeStat('mood', 15); }, type: 'good' },
  { msg: 'You got rained on. Mood dropped.',
    do: () => { changeStat('mood', -15); }, type: 'bad' },
  { msg: 'Investments paid out a dividend!',
    do: () => { const d = Math.floor(state.investments * 0.05); if (d > 0) { earn(d); spawnParticle(`+$${d}`, 'gain'); } }, type: 'good' },
  { msg: () => `Tax day! Lost ${Math.min(25, 10 + state.day)}% of your cash.`,
    do: () => { const pct = Math.min(0.25, 0.10 + state.day * 0.01); const t = Math.floor(state.money * pct); state.money -= t; spawnParticle(`-$${t}`, 'loss'); }, type: 'bad' },
  { msg: 'You got food poisoning! 2 days sick — visit the hospital to recover faster.',
    do: () => { state.sick = Math.max(state.sick, 2); changeStat('energy', -30); changeStat('mood', -15); }, type: 'bad' },
  { msg: 'A stock you own surged!',
    do: () => { const owned = Object.keys(state.stockShares).filter(k => state.stockShares[k] > 0); if (!owned.length) return; const pick = owned[Math.floor(Math.random() * owned.length)]; state.stockPrices[pick] *= 1.15; }, type: 'good' },
  { msg: () => `A stock crashed ${Math.floor(15 + state.day * 0.5)}%!`,
    do: () => { const owned = Object.keys(state.stockShares).filter(k => state.stockShares[k] > 0); if (!owned.length) return; const pick = owned[Math.floor(Math.random() * owned.length)]; const pct = 0.15 + Math.min(0.25, state.day * 0.005); state.stockPrices[pick] *= (1 - pct); }, type: 'bad' },
  { msg: 'Your factory got featured in Bun Weekly!',
    do: () => { if (state.factoryOwned) { state.factoryAccumulated += 500 * diffMult(); spawnParticle(`+$${Math.floor(500 * diffMult())}`, 'gain'); } }, type: 'good' },
  { msg: () => { const a = Math.floor(150 * diffMult()); return `A celebrity ordered hot dogs from you! +$${a}`; },
    do: () => { const a = Math.floor(150 * diffMult()); earn(a); spawnParticle(`+$${a}`, 'gain'); }, type: 'good' },
  // ----- Late-game disasters (only fire after day 5) -----
  { msg: () => `🔥 Equipment fire at the factory! -$${Math.floor(800 * diffMult())}`,
    do: () => { if (!state.factoryOwned) return; const a = Math.floor(800 * diffMult()); state.money = Math.max(0, state.money - a); spawnParticle(`-$${a}`, 'loss'); }, type: 'bad', minDay: 5 },
  { msg: 'A rival hot dog brand poached your top employee. Career stress -mood',
    do: () => { changeStat('mood', -25); }, type: 'bad', minDay: 5 },
  { msg: () => `📰 PR scandal! Damages: $${Math.floor(500 * diffMult())}`,
    do: () => { const a = Math.floor(500 * diffMult()); state.money = Math.max(0, state.money - a); spawnParticle(`-$${a}`, 'loss'); }, type: 'bad', minDay: 8 },
  { msg: 'You hit the headlines as Frankfurter of the Year!',
    do: () => { changeStat('mood', 30); state.xp += 100; }, type: 'good', minDay: 8 },
];

function randomEvent() {
  const pool = EVENTS.filter(e => !e.minDay || state.day >= e.minDay);
  const e = pool[Math.floor(Math.random() * pool.length)];
  e.do();
  const text = typeof e.msg === 'function' ? e.msg() : e.msg;
  notify(text, e.type);
}

// ---------- OUTFIT RENDERING ----------
function renderOutfit() {
  let svg = '';
  switch (state.outfit) {
    case 'tie':
      svg = `<polygon points="50,75 47,82 53,82" fill="#1a3a8a"/>
             <rect x="48" y="80" width="4" height="14" fill="#1a3a8a"/>`;
      break;
    case 'suit':
      svg = `<rect x="32" y="78" width="36" height="22" fill="#1a1a2a" rx="4"/>
             <polygon points="50,78 47,86 53,86" fill="#cc1a1a"/>
             <rect x="48" y="84" width="4" height="14" fill="#cc1a1a"/>
             <circle cx="38" cy="88" r="1.5" fill="#ffd23a"/>
             <circle cx="38" cy="94" r="1.5" fill="#ffd23a"/>`;
      break;
    case 'tux':
      svg = `<rect x="32" y="78" width="36" height="22" fill="#0a0a0f" rx="4"/>
             <polygon points="32,78 50,90 68,78 68,86 50,98 32,86" fill="#fff"/>
             <polygon points="50,80 47,87 53,87" fill="#0a0a0f"/>
             <rect x="49" y="86" width="2" height="6" fill="#0a0a0f"/>`;
      break;
    case 'ceo':
      svg = `<rect x="32" y="78" width="36" height="22" fill="#2a1a4a" rx="4"/>
             <polygon points="32,78 50,90 68,78 68,86 50,98 32,86" fill="#ffd23a"/>
             <polygon points="50,80 47,87 53,87" fill="#cc1a1a"/>
             <rect x="49" y="86" width="2" height="6" fill="#cc1a1a"/>
             <circle cx="50" cy="74" r="3" fill="#ffd23a" stroke="#000" stroke-width="0.5"/>
             <text x="50" y="76" font-size="3" text-anchor="middle" fill="#000" font-weight="bold">$</text>`;
      break;
    default:
      svg = '';
  }
  elOutfit.innerHTML = svg;
  if (elOutfitInt) elOutfitInt.innerHTML = svg;
}

// ---------- NOTIFICATIONS / PARTICLES ----------
function notify(msg, type = 'good') {
  const n = document.createElement('div');
  n.className = 'notif ' + type;
  n.textContent = msg;
  elNotifs.appendChild(n);
  setTimeout(() => n.remove(), 4200);
}

function spawnParticle(text, cls = '') {
  const p = document.createElement('div');
  p.className = 'particle ' + cls;
  p.textContent = text;
  const playerEl = state.interiorBuildingId ? elInteriorPlayer : elPlayer;
  const rect = playerEl.getBoundingClientRect();
  // Append to body so it works in either scene
  p.style.position = 'fixed';
  p.style.left = (rect.left + rect.width / 2 - 20) + 'px';
  p.style.top = (rect.top - 10) + 'px';
  p.style.zIndex = '999';
  document.body.appendChild(p);
  setTimeout(() => p.remove(), 1500);
}

function spawnConfetti() {
  const colors = ['#ffd23a', '#ff7a59', '#34d399', '#8b5cf6', '#3b82f6', '#ec4899'];
  for (let i = 0; i < 60; i++) {
    const c = document.createElement('div');
    c.className = 'confetti';
    c.style.left = Math.random() * 100 + 'vw';
    c.style.background = colors[Math.floor(Math.random() * colors.length)];
    c.style.animationDelay = (Math.random() * 0.5) + 's';
    c.style.transform = `rotate(${Math.random() * 360}deg)`;
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 3500);
  }
}

// ---------- WIN ----------
function doWin() {
  state.hasWon = true;
  closeModal();
  exitInterior();
  clearSave();
  $('winTitle').textContent = CAREERS[state.careerLevel].title;
  $('winDays').textContent = state.day;
  $('winMoney').textContent = networth().toLocaleString();
  $('winScreen').classList.remove('hidden');
  $('saveControls').classList.add('hidden');
  $('submitScoreBtn').disabled = false;
  $('winName').disabled = false;
  $('submitStatus').textContent = '';
  $('submitStatus').className = 'submit-status';
  spawnConfetti();
  setTimeout(spawnConfetti, 800);
  setTimeout(spawnConfetti, 1600);
}

// ---------- SAVE / LOAD ----------
function hasSave() {
  try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; }
}

function saveGame() {
  try {
    const snapshot = {
      v: 3,
      ts: Date.now(),
      money: state.money,
      energy: state.energy,
      hunger: state.hunger,
      mood: state.mood,
      xp: state.xp,
      careerLevel: state.careerLevel,
      day: state.day,
      timeMin: state.timeMin,
      playerWorldX: state.playerWorldX,
      facing: state.facing,
      hasJob: state.hasJob,
      ownsCart: state.ownsCart,
      ownsApartment: state.ownsApartment,
      ownsMansion: state.ownsMansion,
      investments: state.investments,
      outfit: state.outfit,
      totalEarned: state.totalEarned,
      hasWon: state.hasWon,
      factoryOwned: state.factoryOwned,
      factoryAutomation: state.factoryAutomation,
      factoryAccumulated: state.factoryAccumulated,
      stockShares: state.stockShares,
      stockPrices: state.stockPrices,
      educationLevel: state.educationLevel,
      sick: state.sick,
      xpFatigue: state.xpFatigue,
      sickStreak: state.sickStreak,
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot));
  } catch (e) {
    console.warn('Save failed:', e);
  }
}

function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const s = JSON.parse(raw);
    if (!s || typeof s !== 'object') return false;
    Object.assign(state, s);
    return true;
  } catch (e) {
    console.warn('Load failed:', e);
    return false;
  }
}

function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch {}
}

function showSaveToast() {
  const t = $('saveToast');
  t.classList.remove('hidden');
  clearTimeout(showSaveToast._t);
  showSaveToast._t = setTimeout(() => t.classList.add('hidden'), 2100);
}

// ---------- LEADERBOARD ----------
function networth() {
  return Math.floor(state.money) + Math.floor(state.investments) + Math.floor(stockPortfolioValue());
}

async function fetchGlobalLeaderboard() {
  if (!API_URL) throw new Error('No global API configured');
  const r = await fetch(API_URL.replace(/\/+$/, '') + '/api/leaderboard', { method: 'GET' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return await r.json();
}

async function postGlobalScore(entry) {
  if (!API_URL) throw new Error('No global API configured');
  const r = await fetch(API_URL.replace(/\/+$/, '') + '/api/leaderboard', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return await r.json();
}

function getLocalLeaderboard() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_LB_KEY) || '[]');
  } catch { return []; }
}

function saveLocalLeaderboard(entry) {
  const list = getLocalLeaderboard();
  list.push({ ...entry, created_at: new Date().toISOString() });
  list.sort((a, b) => a.days - b.days || b.networth - a.networth);
  const trimmed = list.slice(0, 20);
  try { localStorage.setItem(LOCAL_LB_KEY, JSON.stringify(trimmed)); } catch {}
}

function openLeaderboard(tab) {
  document.querySelectorAll('.lb-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  $('leaderboardModal').classList.remove('hidden');
  renderLeaderboard(tab);
}

function closeLeaderboard() {
  $('leaderboardModal').classList.add('hidden');
}

async function renderLeaderboard(tab) {
  const status = $('lbStatus');
  const body = $('lbBody');
  body.innerHTML = '';
  if (tab === 'global') {
    if (!API_URL) {
      status.textContent = 'Global leaderboard not configured. Showing local instead.';
      renderRows(getLocalLeaderboard());
      return;
    }
    status.textContent = 'Loading global scores...';
    try {
      const list = await fetchGlobalLeaderboard();
      status.textContent = list.length ? `Top ${list.length} from around the world` : '';
      renderRows(list);
    } catch (e) {
      status.textContent = 'Could not reach global leaderboard. Showing local.';
      renderRows(getLocalLeaderboard());
    }
  } else {
    const list = getLocalLeaderboard();
    status.textContent = list.length ? 'Your wins on this device' : '';
    renderRows(list);
  }
}

function renderRows(list) {
  const body = $('lbBody');
  if (!list || list.length === 0) {
    body.innerHTML = '<tr><td colspan="5" class="lb-empty">No wins yet. Be the first frankfurter!</td></tr>';
    return;
  }
  const medals = ['🥇', '🥈', '🥉'];
  body.innerHTML = list.map((row, i) => `
    <tr>
      <td><span class="rank-medal">${medals[i] || (i + 1)}</span></td>
      <td>${escapeHtml(row.name || 'Anon')}</td>
      <td>${escapeHtml(row.career || '?')}</td>
      <td>${row.days}</td>
      <td>$${Number(row.networth).toLocaleString()}</td>
    </tr>
  `).join('');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

async function submitScore() {
  const nameInput = $('winName');
  const status = $('submitStatus');
  let name = (nameInput.value || '').trim().slice(0, 20);
  if (!name) {
    status.textContent = 'Enter a name first.';
    status.className = 'submit-status err';
    return;
  }
  localStorage.setItem(PLAYER_NAME_KEY, name);
  const entry = {
    name,
    career: CAREERS[state.careerLevel].title,
    days: state.day,
    networth: networth(),
  };
  status.textContent = 'Submitting...';
  status.className = 'submit-status';

  // Always save locally
  saveLocalLeaderboard(entry);

  // Try global if configured
  if (API_URL) {
    try {
      await postGlobalScore(entry);
      status.textContent = '✓ Submitted to the global leaderboard!';
      status.className = 'submit-status ok';
    } catch (e) {
      status.textContent = '⚠ Saved locally (global leaderboard offline).';
      status.className = 'submit-status err';
    }
  } else {
    status.textContent = '✓ Saved to local leaderboard.';
    status.className = 'submit-status ok';
  }
  $('submitScoreBtn').disabled = true;
  nameInput.disabled = true;
}

// ---------- BOOT ----------
init();

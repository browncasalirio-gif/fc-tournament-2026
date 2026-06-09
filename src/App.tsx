import React, { useState, useEffect, useMemo, useRef, useCallback, Component, ErrorInfo, ReactNode } from 'react';
// Version: 1.0.1 - Guest Sync Fix
import { GoogleGenAI } from "@google/genai";
import { 
  Trophy, 
  Calendar, 
  Users, 
  MessageSquare, 
  ShieldCheck, 
  Plus, 
  Trash2, 
  Edit3,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  Share2,
  Swords,
  LogOut,
  LogIn,
  User as UserIcon,
  Newspaper,
  MessageCircle,
  Send,
  Eye,
  EyeOff
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  auth, 
  db, 
  loginWithGoogle, 
  loginWithEmail,
  registerWithEmail,
  loginAnonymously,
  updateAuthProfile,
  logout, 
  resetPassword,
  handleFirestoreError, 
  OperationType 
} from './firebase';
import { 
  onAuthStateChanged, 
  User 
} from 'firebase/auth';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  serverTimestamp,
  setDoc,
  getDoc,
  getDocs,
  writeBatch
} from 'firebase/firestore';

type Player = {
  id: string;
  name: string;
  club: string;
  ownerUid: string;
  bio?: string;
  active?: boolean;
};

type Fixture = {
  id: string;
  matchday: number;
  homeId: string;
  awayId: string;
  homeName: string;
  awayName: string;
  homeScore: number | null;
  awayScore: number | null;
  status: 'pending' | 'played' | 'overdue';
  deadline: string;
  competition: 'league' | 'uefa' | 'preseason' | 'playoff';
  ownerUid: string;
  seasonId?: string;
  round?: 'QF' | 'SF' | 'F';
};

type Season = {
  id: string;
  name: string;
  active: boolean;
  createdAt: any;
};

type PreRegisteredPsn = {
  id: string;
  psnId: string;
  claimed: boolean;
  role: 'admin' | 'user';
};

type Tab = 'table' | 'fixtures' | 'players' | 'h2h' | 'rules' | 'uefa' | 'admin' | 'market' | 'news' | 'playoff' | 'halloffame' | 'wc';

type Champion = {
  season: string;
  winner: string;
  runnerUp?: string;
  year?: string;
};

type News = {
  id: string;
  title: string;
  content: string;
  authorUid: string;
  authorName: string;
  createdAt: any;
  imageUrl?: string;
};

type Comment = {
  id: string;
  fixtureId: string;
  authorUid: string;
  authorName: string;
  authorPhoto?: string;
  text: string;
  createdAt: any;
};

type Auction = {
  id: string;
  playerId: string;
  playerName: string;
  sellerUid: string;
  currentBid: number;
  highestBidderUid?: string;
  highestBidderName?: string;
  endTime: string;
  status: 'active' | 'completed' | 'cancelled';
};

type TableRow = {
  id: string;
  name: string;
  club: string;
  p: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  pts: number;
  form: string[];
};

// Error Boundary Component
class ErrorBoundary extends React.Component<any, any> {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-pl-ink text-white p-6 text-center">
          <div className="glass p-8 rounded-2xl max-w-md w-full border-l-4 border-red-500">
            <AlertCircle className="mx-auto text-red-500 mb-4" size={48} />
            <h1 className="text-2xl font-display mb-2 uppercase tracking-wider">Something went wrong</h1>
            <p className="text-white/60 font-condensed mb-6 uppercase tracking-widest text-xs">
              {this.state.error?.message || "An unexpected error occurred"}
            </p>
            <button 
              onClick={() => window.location.reload()}
              className="bg-pl-cyan text-pl-ink px-6 py-2 rounded-full font-condensed font-bold uppercase tracking-widest hover:scale-105 transition-transform"
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }
    return (this as any).props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <LeagueApp />
    </ErrorBoundary>
  );
}

function LeagueApp() {
  const [user, setUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('table');
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);

  // Tab scroll indicators
  const tabsRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkTabScroll = useCallback(() => {
    const el = tabsRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 5);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 5);
  }, []);

  useEffect(() => {
    const el = tabsRef.current;
    if (!el) return;
    checkTabScroll();
    // Re-check after a short delay to handle late renders
    const timer = setTimeout(checkTabScroll, 300);
    el.addEventListener('scroll', checkTabScroll);
    window.addEventListener('resize', checkTabScroll);
    return () => {
      clearTimeout(timer);
      el.removeEventListener('scroll', checkTabScroll);
      window.removeEventListener('resize', checkTabScroll);
    };
  }, [checkTabScroll, activeTab]);

  const scrollTabs = (dir: 'left' | 'right') => {
    const el = tabsRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === 'left' ? -200 : 200, behavior: 'smooth' });
  };
  const [showModal, setShowModal] = useState(false);
  const [selectedFixture, setSelectedFixture] = useState<Fixture | null>(null);
  const [h2hPlayers, setH2hPlayers] = useState({ p1: '', p2: '' });
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [scores, setScores] = useState({ home: 0, away: 0 });
  const [bulkText, setBulkText] = useState('');
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isGuest, setIsGuest] = useState(false);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [selectedUserUid, setSelectedUserUid] = useState<string | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [showPlayerModal, setShowPlayerModal] = useState(false);
  const [playerBio, setPlayerBio] = useState('');
  const [auctions, setAuctions] = useState<Auction[]>([]);
  const [userBudget, setUserBudget] = useState<number>(100);
  const [showAuctionModal, setShowAuctionModal] = useState(false);
  const [auctionPlayer, setAuctionPlayer] = useState<Player | null>(null);
  const [bidAmount, setBidAmount] = useState<number>(0);
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [allFixtures, setAllFixtures] = useState<Fixture[]>([]);
  const [news, setNews] = useState<News[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [newNews, setNewNews] = useState({ title: '', content: '', imageUrl: '' });
  const [editingNews, setEditingNews] = useState<News | null>(null);
  const [newComment, setNewComment] = useState('');
  const [showNewsModal, setShowNewsModal] = useState(false);
  const [bulkResultsText, setBulkResultsText] = useState('');
  const [h2hEditingFixture, setH2hEditingFixture] = useState<string | null>(null);
  const [h2hScores, setH2hScores] = useState<{ home: number; away: number }>({ home: 0, away: 0 });
  const [h2hMode, setH2hMode] = useState<'versus' | 'all'>('versus');
  const [h2hSoloPlayer, setH2hSoloPlayer] = useState('');
  const [playoffEditingFixture, setPlayoffEditingFixture] = useState<string | null>(null);
  const [playoffScores, setPlayoffScores] = useState<{ home: number; away: number }>({ home: 0, away: 0 });
  const [pin, setPin] = useState('');
  const [authError, setAuthError] = useState('');
  const [isAdminLoginMode, setIsAdminLoginMode] = useState(false);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [currentSeasonId, setCurrentSeasonId] = useState<string | null>(null);
  const [showSeasonModal, setShowSeasonModal] = useState(false);
  const [newSeasonName, setNewSeasonName] = useState('');
  const [showPreseasonModal, setShowPreseasonModal] = useState(false);
  const [adminEmails, setAdminEmails] = useState<string[]>([]);
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [champions, setChampions] = useState<Champion[]>([]);
  const [editingChampion, setEditingChampion] = useState<number | null>(null);
  const [newChampion, setNewChampion] = useState<Champion>({ season: '', winner: '', runnerUp: '', year: '' });
  const [preseasonFixture, setPreseasonFixture] = useState({ homeId: '', awayId: '' });

  const fixtures = useMemo(() => {
    return allFixtures.filter(f => f.competition === 'league' && f.seasonId === currentSeasonId);
  }, [allFixtures, currentSeasonId]);

  const uefaFixtures = useMemo(() => {
    return allFixtures.filter(f => f.competition === 'uefa' && f.seasonId === currentSeasonId);
  }, [allFixtures, currentSeasonId]);

  const preseasonFixtures = useMemo(() => {
    return allFixtures.filter(f => f.competition === 'preseason' && f.seasonId === currentSeasonId);
  }, [allFixtures, currentSeasonId]);

  const playoffFixtures = useMemo(() => {
    return allFixtures.filter(f => f.competition === 'playoff' && f.seasonId === currentSeasonId);
  }, [allFixtures, currentSeasonId]);

  const getPlayerForm = (playerId: string) => {
    const playerFixtures = [...fixtures, ...uefaFixtures, ...preseasonFixtures]
      .filter(f => (f.homeId === playerId || f.awayId === playerId) && f.status === 'played')
      .sort((a, b) => {
        // Sort by matchday descending
        return b.matchday - a.matchday;
      })
      .slice(0, 5);

    return playerFixtures.map(f => {
      const isHome = f.homeId === playerId;
      const myScore = isHome ? f.homeScore! : f.awayScore!;
      const oppScore = isHome ? f.awayScore! : f.homeScore!;
      if (myScore > oppScore) return 'W';
      if (myScore < oppScore) return 'L';
      return 'D';
    });
  };

  const playerIdsByName = useMemo(() => {
    const map: Record<string, string[]> = {};
    allPlayers.forEach(p => {
      if (!map[p.name]) map[p.name] = [];
      map[p.name].push(p.id);
    });
    return map;
  }, [allPlayers]);

  const h2hData = useMemo(() => {
    if (!h2hPlayers.p1 || !h2hPlayers.p2 || h2hPlayers.p1 === h2hPlayers.p2) return null;
    // Get all IDs for each player name to handle duplicates
    const p1Name = allPlayers.find(p => p.id === h2hPlayers.p1)?.name;
    const p2Name = allPlayers.find(p => p.id === h2hPlayers.p2)?.name;
    if (!p1Name || !p2Name) return null;
    const p1Ids = new Set(playerIdsByName[p1Name] || [h2hPlayers.p1]);
    const p2Ids = new Set(playerIdsByName[p2Name] || [h2hPlayers.p2]);
    const matches = allFixtures.filter(f =>
      ((p1Ids.has(f.homeId) && p2Ids.has(f.awayId)) ||
       (p2Ids.has(f.homeId) && p1Ids.has(f.awayId))) &&
      f.seasonId === currentSeasonId
    );
    const played = matches.filter(f => f.status === 'played');
    let p1w = 0, p2w = 0, draws = 0, p1g = 0, p2g = 0;
    played.forEach(f => {
      const isP1Home = p1Ids.has(f.homeId);
      const p1Goals = isP1Home ? f.homeScore! : f.awayScore!;
      const p2Goals = isP1Home ? f.awayScore! : f.homeScore!;
      p1g += p1Goals;
      p2g += p2Goals;
      if (p1Goals > p2Goals) p1w++;
      else if (p2Goals > p1Goals) p2w++;
      else draws++;
    });
    const sortedMatches = [...matches].sort((a, b) => {
      if (a.matchday !== b.matchday) return a.matchday - b.matchday;
      return (a.deadline || '').localeCompare(b.deadline || '');
    });
    return { matches: sortedMatches, p1w, p2w, draws, p1g, p2g, p1Ids, p2Ids };
  }, [h2hPlayers, allFixtures, currentSeasonId, allPlayers, playerIdsByName]);

  const soloPlayerData = useMemo(() => {
    if (!h2hSoloPlayer) return null;
    // Get all IDs for this player name to handle duplicates
    const pName = allPlayers.find(p => p.id === h2hSoloPlayer)?.name;
    if (!pName) return null;
    const pIds = new Set(playerIdsByName[pName] || [h2hSoloPlayer]);
    const matches = allFixtures.filter(f =>
      (pIds.has(f.homeId) || pIds.has(f.awayId)) &&
      f.seasonId === currentSeasonId &&
      f.status === 'played' &&
      f.competition === 'league'
    );
    // Sort most recent first (highest matchday first)
    const sorted = [...matches].sort((a, b) => b.matchday - a.matchday);
    let wins = 0, losses = 0, draws = 0, gf = 0, ga = 0;
    sorted.forEach(f => {
      const isHome = pIds.has(f.homeId);
      const myGoals = isHome ? f.homeScore! : f.awayScore!;
      const oppGoals = isHome ? f.awayScore! : f.homeScore!;
      gf += myGoals;
      ga += oppGoals;
      if (myGoals > oppGoals) wins++;
      else if (myGoals < oppGoals) losses++;
      else draws++;
    });
    return { matches: sorted, wins, losses, draws, gf, ga, played: sorted.length, pIds };
  }, [h2hSoloPlayer, allFixtures, currentSeasonId]);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
      if (currentUser) {
        // Save user profile
        const userRef = doc(db, 'users', currentUser.uid);
        const userSnap = await getDoc(userRef);
        
        let role = 'user';
        if (userSnap.exists()) {
          role = userSnap.data().role || 'user';
        }
        
        // Check admin emails from Firestore + hardcoded fallback
        const userEmail = currentUser.email?.toLowerCase().trim();
        console.log("Auth State Changed: User Email =", userEmail);

        const hardcodedAdmins = ['olaniyantoheebola@gmail.com', 'thelegendaryeman@gmail.com', 'alikibogy@gmail.com'];
        let isHardcodedAdmin = false;

        // Fetch dynamic admin emails from Firestore
        try {
          const adminEmailsSnap = await getDoc(doc(db, 'config', 'adminEmails'));
          const firestoreAdmins: string[] = adminEmailsSnap.exists() ? (adminEmailsSnap.data().emails || []) : [];
          const allAdmins = [...new Set([...hardcodedAdmins, ...firestoreAdmins])];
          if (userEmail && allAdmins.includes(userEmail)) {
            role = 'admin';
            isHardcodedAdmin = true;
            console.log("Admin access granted for:", userEmail);
          }
        } catch {
          // Fallback to hardcoded list if Firestore read fails
          if (userEmail && hardcodedAdmins.includes(userEmail)) {
            role = 'admin';
            isHardcodedAdmin = true;
            console.log("Admin access granted (fallback) for:", userEmail);
          }
        }
        
        const finalIsAdmin = role === 'admin' || isHardcodedAdmin;
        setIsAdmin(finalIsAdmin);
        setSelectedUserUid(currentUser.uid);

        if (finalIsAdmin) {
          showToast(`Logged in as Admin: ${userEmail}`);
        }

        setDoc(userRef, {
          uid: currentUser.uid,
          displayName: currentUser.displayName,
          email: currentUser.email,
          photoURL: currentUser.photoURL,
          role: role,
          budget: userSnap.exists() ? (userSnap.data().budget ?? 100) : 100,
          createdAt: serverTimestamp()
        }, { merge: true }).catch(err => console.error("Failed to save user profile", err));
      } else {
        setIsAdmin(false);
        setSelectedUserUid(null);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (isAdmin) {
      const unsubUsers = onSnapshot(collection(db, 'users'), (snapshot) => {
        setAllUsers(snapshot.docs.map(doc => doc.data()));
      }, (err) => handleFirestoreError(err, OperationType.LIST, 'users'));
      return () => unsubUsers();
    }
  }, [isAdmin]);

  useEffect(() => {
    if (isAdmin) {
      const unsubAdminEmails = onSnapshot(doc(db, 'config', 'adminEmails'), (snap) => {
        setAdminEmails(snap.exists() ? (snap.data().emails || []) : []);
      });
      return () => unsubAdminEmails();
    }
  }, [isAdmin]);

  useEffect(() => {
    const unsubChampions = onSnapshot(doc(db, 'config', 'champions'), (snap) => {
      setChampions(snap.exists() ? (snap.data().list || []) : []);
    });
    return () => unsubChampions();
  }, []);

  useEffect(() => {
    if (!isAuthReady) return;
    // Pre-registration removed
  }, [isAuthReady]);

  useEffect(() => {
    if (!isAuthReady || (!user && !isGuest)) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const selectedUid = user?.uid || 'guest';
    const playersQuery = query(collection(db, 'players'), where('ownerUid', '==', selectedUid));
    const fixturesQuery = query(collection(db, 'fixtures'), where('ownerUid', '==', selectedUid));

    const unsubPlayers = onSnapshot(playersQuery, (snapshot) => {
      const pData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Player));
      setPlayers(pData);
      setLoading(false);
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'players'));

    const unsubFixtures = onSnapshot(fixturesQuery, (snapshot) => {
      // We use allFixtures now for derived states
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'fixtures'));

    const unsubAllPlayers = onSnapshot(collection(db, 'players'), (snapshot) => {
      setAllPlayers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Player)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'players'));

    const unsubAllFixtures = onSnapshot(collection(db, 'fixtures'), (snapshot) => {
      setAllFixtures(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Fixture)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'fixtures'));

    const unsubAuctions = onSnapshot(collection(db, 'auctions'), (snapshot) => {
      setAuctions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Auction)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'auctions'));

    const unsubBudget = user ? onSnapshot(doc(db, 'users', user.uid), (doc) => {
      if (doc.exists()) {
        setUserBudget(doc.data().budget ?? 100);
      }
    }) : () => {};

    const unsubNews = onSnapshot(collection(db, 'news'), (snapshot) => {
      setNews(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as News)).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'news'));

    const unsubComments = onSnapshot(collection(db, 'comments'), (snapshot) => {
      setComments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Comment)).sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'comments'));

    const unsubSeasons = onSnapshot(collection(db, 'seasons'), (snapshot) => {
      const sData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Season)).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setSeasons(sData);
      if (sData.length > 0 && !currentSeasonId) {
        const active = sData.find(s => s.active);
        setCurrentSeasonId(active ? active.id : sData[0].id);
      }
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'seasons'));

    return () => {
      unsubPlayers();
      unsubFixtures();
      unsubAllPlayers();
      unsubAllFixtures();
      unsubAuctions();
      unsubBudget();
      unsubNews();
      unsubComments();
      unsubSeasons();
    };
  }, [isAuthReady, user, selectedUserUid, isGuest]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    
    if (pin === '2580') {
      try {
        await loginAnonymously();
        showToast("Welcome to the League Viewer!");
      } catch (err: any) {
        console.error("Auth error", err);
        // If anonymous auth is disabled, we still allow entry as a guest
        setIsGuest(true);
        showToast("Entered as Guest Viewer");
      }
    } else {
      setAuthError("Invalid PIN. Please try again.");
    }
  };

  const addSeason = async () => {
    if (!isAdmin || !newSeasonName.trim()) return;
    try {
      const seasonRef = doc(collection(db, 'seasons'));
      await setDoc(seasonRef, {
        name: newSeasonName.trim(),
        active: seasons.length === 0,
        createdAt: serverTimestamp()
      });
      setNewSeasonName('');
      setShowSeasonModal(false);
      showToast("Season created!");
    } catch (err) {
      console.error("Add season failed", err);
      showToast("Failed to create season", 'error');
    }
  };

  const toggleSeasonActive = async (seasonId: string) => {
    if (!isAdmin) return;
    try {
      const batch = writeBatch(db);
      seasons.forEach(s => {
        batch.update(doc(db, 'seasons', s.id), { active: s.id === seasonId });
      });
      await batch.commit();
      setCurrentSeasonId(seasonId);
      showToast("Active season updated!");
    } catch (err) {
      console.error("Toggle season failed", err);
    }
  };

  const addPreseasonFixture = async () => {
    if (!isAdmin || !preseasonFixture.homeId || !preseasonFixture.awayId || !currentSeasonId) return;
    try {
      const homePlayer = players.find(p => p.id === preseasonFixture.homeId)!;
      const awayPlayer = players.find(p => p.id === preseasonFixture.awayId)!;
      
      await addDoc(collection(db, 'fixtures'), {
        matchday: 0,
        homeId: preseasonFixture.homeId,
        awayId: preseasonFixture.awayId,
        homeName: homePlayer.name,
        awayName: awayPlayer.name,
        homeScore: null,
        awayScore: null,
        status: 'pending',
        deadline: new Date().toISOString().split('T')[0],
        competition: 'preseason',
        ownerUid: user!.uid,
        seasonId: currentSeasonId
      });
      setShowPreseasonModal(false);
      setPreseasonFixture({ homeId: '', awayId: '' });
      showToast("Preseason match added!");
    } catch (err) {
      console.error("Add preseason failed", err);
    }
  };

  const TEAMS_POOL = [
    "Aston Villa", "Brighton & Hove Albion", "Brentford", "Burnley", "Crystal Palace",
    "Everton", "Fulham", "Ipswich Town", "Leicester City", "Luton Town",
    "Nottingham Forest", "Sheffield United", "West Ham United", "Wolverhampton Wanderers",
    "Olympique de Marseille", "Newcastle United", "Tottenham Hotspur", "Chelsea",
    "Manchester United", "Liverpool", "Manchester City", "Arsenal"
  ];

  const generateSeason = async () => {
    if (!isAdmin || !user || !currentSeasonId) {
      showToast("Please select or create a season first", 'error');
      return;
    }
    try {
      setLoading(true);
      const activePlayers = uniquePlayers.filter(p => p.active !== false);
      if (activePlayers.length < 2) throw new Error("Need at least 2 active players to generate fixtures. Mark players as active in the Squad tab.");

      const batch = writeBatch(db);

      // Randomize teams for each player
      const shuffledTeams = [...TEAMS_POOL].sort(() => Math.random() - 0.5);
      const updatedPlayers = activePlayers.map((p, index) => {
        const assignedTeam = shuffledTeams[index % shuffledTeams.length];
        batch.update(doc(db, 'players', p.id), { club: assignedTeam });
        return { ...p, club: assignedTeam };
      });

      // Clear existing league fixtures for THIS season
      const existingFixtures = fixtures.filter(f => f.competition === 'league' && f.seasonId === currentSeasonId);
      existingFixtures.forEach(f => {
        batch.delete(doc(db, 'fixtures', f.id));
      });

      // Generate Double Round Robin
      let teamIds = updatedPlayers.map(p => p.id);
      if (teamIds.length % 2 !== 0) {
        teamIds.push('BYE'); // Add dummy player for odd number of teams
      }
      
      const n = teamIds.length;
      const roundsPerHalf = n - 1;
      const matchesPerRound = n / 2;
      const today = new Date();

      // First Half (Home/Away assigned by rotation)
      for (let round = 0; round < roundsPerHalf; round++) {
        const deadline = new Date(today);
        deadline.setDate(today.getDate() + (round + 1) * 7);
        const deadlineStr = deadline.toISOString().split('T')[0];

        for (let i = 0; i < matchesPerRound; i++) {
          const homeIdx = (round + i) % (n - 1);
          let awayIdx = (n - 1 - i + round) % (n - 1);

          if (i === 0) awayIdx = n - 1;

          const homeId = teamIds[homeIdx];
          const awayId = teamIds[awayIdx];

          if (homeId !== 'BYE' && awayId !== 'BYE') {
            const homePlayer = updatedPlayers.find(p => p.id === homeId)!;
            const awayPlayer = updatedPlayers.find(p => p.id === awayId)!;

            const fixtureRef = doc(collection(db, 'fixtures'));
            batch.set(fixtureRef, {
              matchday: round + 1,
              homeId,
              awayId,
              homeName: homePlayer.name,
              awayName: awayPlayer.name,
              homeScore: null,
              awayScore: null,
              status: 'pending',
              deadline: deadlineStr,
              competition: 'league',
              ownerUid: user.uid,
              seasonId: currentSeasonId
            });
          }
        }
      }

      // Second Half (Reverse Home/Away)
      for (let round = 0; round < roundsPerHalf; round++) {
        const matchday = round + 1 + roundsPerHalf;
        const deadline = new Date(today);
        deadline.setDate(today.getDate() + (matchday) * 7);
        const deadlineStr = deadline.toISOString().split('T')[0];

        for (let i = 0; i < matchesPerRound; i++) {
          const homeIdx = (round + i) % (n - 1);
          let awayIdx = (n - 1 - i + round) % (n - 1);

          if (i === 0) awayIdx = n - 1;

          // Swap home and away for the second half
          const awayId = teamIds[homeIdx];
          const homeId = teamIds[awayIdx];

          if (homeId !== 'BYE' && awayId !== 'BYE') {
            const homePlayer = updatedPlayers.find(p => p.id === homeId)!;
            const awayPlayer = updatedPlayers.find(p => p.id === awayId)!;

            const fixtureRef = doc(collection(db, 'fixtures'));
            batch.set(fixtureRef, {
              matchday: matchday,
              homeId,
              awayId,
              homeName: homePlayer.name,
              awayName: awayPlayer.name,
              homeScore: null,
              awayScore: null,
              status: 'pending',
              deadline: deadlineStr,
              competition: 'league',
              ownerUid: user.uid,
              seasonId: currentSeasonId
            });
          }
        }
      }

      await batch.commit();
      showToast("Double Round Robin Season generated with randomized teams!");
    } catch (err) {
      console.error("Generation failed", err);
      showToast(err instanceof Error ? err.message : "Generation failed", 'error');
    } finally {
      setLoading(false);
    }
  };

  const endLeague = async () => {
    if (!isAdmin || !user || !currentSeasonId) return;
    const pendingLeague = fixtures.filter(f => f.status !== 'played');
    if (pendingLeague.length === 0) {
      showToast("All league fixtures are already played!", 'success');
      return;
    }
    if (!window.confirm(`This will remove ${pendingLeague.length} unplayed fixture(s) and end the league. Played matches and the table will stay exactly as they are. Proceed?`)) return;
    try {
      setLoading(true);
      const batch = writeBatch(db);
      pendingLeague.forEach(f => {
        batch.delete(doc(db, 'fixtures', f.id));
      });
      await batch.commit();
      showToast(`League ended! ${pendingLeague.length} unplayed fixture(s) removed. You can now generate playoffs.`);
    } catch (err) {
      console.error("End league failed", err);
      showToast("Failed to end league", 'error');
    } finally {
      setLoading(false);
    }
  };

  // Helper: get playoff ties grouped by round
  const getPlayoffTies = (round: 'QF' | 'SF' | 'F') => {
    const roundFixtures = playoffFixtures.filter(f => f.round === round);
    const ties: Map<string, Fixture[]> = new Map();
    roundFixtures.forEach(f => {
      const key = [f.homeId, f.awayId].sort().join('-');
      if (!ties.has(key)) ties.set(key, []);
      ties.get(key)!.push(f);
    });
    return Array.from(ties.values()).map(legs => legs.sort((a, b) => a.matchday - b.matchday));
  };

  // Returns playoff aggregate winner between two players from playoffFixtures
  const getPlayoffWinner = (p1Id: string, p2Id: string, round?: 'QF' | 'SF' | 'F'): string | null => {
    let legs = playoffFixtures.filter(f =>
      (f.homeId === p1Id && f.awayId === p2Id) ||
      (f.homeId === p2Id && f.awayId === p1Id)
    );
    if (round) legs = legs.filter(f => f.round === round);
    if (legs.length < 2 || legs.some(l => l.status !== 'played')) return null;
    let p1Goals = 0, p2Goals = 0;
    legs.forEach(f => {
      if (f.homeId === p1Id) { p1Goals += f.homeScore || 0; p2Goals += f.awayScore || 0; }
      else { p2Goals += f.homeScore || 0; p1Goals += f.awayScore || 0; }
    });
    if (p1Goals > p2Goals) return p1Id;
    if (p2Goals > p1Goals) return p2Id;
    // Tiebreak: higher seed (p1) advances on exact tie
    return p1Id;
  };

  const generatePlayoffs = async () => {
    if (!isAdmin || !user || !currentSeasonId) {
      showToast("Please select a season first", 'error');
      return;
    }
    try {
      setLoading(true);
      const activeTableData = tableData.filter(p => p.p > 0);
      if (activeTableData.length < 8) {
        throw new Error(`Need at least 8 players with games played. Currently only ${activeTableData.length} have played.`);
      }
      // Check all league fixtures are played
      const pendingLeague = fixtures.filter(f => f.status !== 'played');
      if (pendingLeague.length > 0) {
        throw new Error(`${pendingLeague.length} league fixture(s) still pending. Complete the league first.`);
      }
      // Delete existing playoff fixtures for this season
      const batch = writeBatch(db);
      playoffFixtures.forEach(f => batch.delete(doc(db, 'fixtures', f.id)));

      const today = new Date();
      const deadline1 = new Date(today); deadline1.setDate(today.getDate() + 7);
      const deadline2 = new Date(today); deadline2.setDate(today.getDate() + 14);

      // QF seedings: 1v8, 4v5, 2v7, 3v6
      const seeds = [
        { higher: activeTableData[0], lower: activeTableData[7] }, // 1st vs 8th
        { higher: activeTableData[3], lower: activeTableData[4] }, // 4th vs 5th
        { higher: activeTableData[1], lower: activeTableData[6] }, // 2nd vs 7th
        { higher: activeTableData[2], lower: activeTableData[5] }, // 3rd vs 6th
      ];

      seeds.forEach(({ higher, lower }) => {
        // Leg 1: higher seed at home
        const ref1 = doc(collection(db, 'fixtures'));
        batch.set(ref1, {
          matchday: 1, homeId: higher.id, awayId: lower.id,
          homeName: higher.name, awayName: lower.name,
          homeScore: null, awayScore: null, status: 'pending',
          deadline: deadline1.toISOString().split('T')[0],
          competition: 'playoff', round: 'QF', ownerUid: user.uid, seasonId: currentSeasonId,
        });
        // Leg 2: lower seed at home
        const ref2 = doc(collection(db, 'fixtures'));
        batch.set(ref2, {
          matchday: 2, homeId: lower.id, awayId: higher.id,
          homeName: lower.name, awayName: higher.name,
          homeScore: null, awayScore: null, status: 'pending',
          deadline: deadline2.toISOString().split('T')[0],
          competition: 'playoff', round: 'QF', ownerUid: user.uid, seasonId: currentSeasonId,
        });
      });

      await batch.commit();
      showToast("Quarter-Final fixtures generated! Top 8 advance to playoffs.");
    } catch (err) {
      console.error("Playoff generation failed", err);
      showToast(err instanceof Error ? err.message : "Playoff generation failed", 'error');
    } finally {
      setLoading(false);
    }
  };

  const generateSemiFinals = async () => {
    if (!isAdmin || !user || !currentSeasonId) return;
    try {
      setLoading(true);
      const activeTableData = tableData.filter(p => p.p > 0);
      if (activeTableData.length < 8) throw new Error("Not enough players");

      // QF seedings: 1v8, 4v5, 2v7, 3v6
      const qfPairs = [
        [activeTableData[0].id, activeTableData[7].id], // Match 1
        [activeTableData[3].id, activeTableData[4].id], // Match 2
        [activeTableData[1].id, activeTableData[6].id], // Match 3
        [activeTableData[2].id, activeTableData[5].id], // Match 4
      ];

      const w1 = getPlayoffWinner(qfPairs[0][0], qfPairs[0][1], 'QF');
      const w2 = getPlayoffWinner(qfPairs[1][0], qfPairs[1][1], 'QF');
      const w3 = getPlayoffWinner(qfPairs[2][0], qfPairs[2][1], 'QF');
      const w4 = getPlayoffWinner(qfPairs[3][0], qfPairs[3][1], 'QF');

      if (!w1 || !w2 || !w3 || !w4) {
        throw new Error("Complete all Quarter-Final matches first.");
      }

      // Delete existing SF & F fixtures
      const batch = writeBatch(db);
      playoffFixtures.filter(f => f.round === 'SF' || f.round === 'F').forEach(f => batch.delete(doc(db, 'fixtures', f.id)));

      const today = new Date();
      const deadline1 = new Date(today); deadline1.setDate(today.getDate() + 7);
      const deadline2 = new Date(today); deadline2.setDate(today.getDate() + 14);

      const getName = (id: string) => {
        const p = allPlayers.find(pl => pl.id === id);
        return p?.name || tableData.find(t => t.id === id)?.name || id;
      };

      // SF1: Winner M1 vs Winner M2, SF2: Winner M3 vs Winner M4
      const sfPairs = [
        { home: w1, away: w2 },
        { home: w3, away: w4 },
      ];

      sfPairs.forEach(({ home, away }) => {
        const ref1 = doc(collection(db, 'fixtures'));
        batch.set(ref1, {
          matchday: 1, homeId: home, awayId: away,
          homeName: getName(home), awayName: getName(away),
          homeScore: null, awayScore: null, status: 'pending',
          deadline: deadline1.toISOString().split('T')[0],
          competition: 'playoff', round: 'SF', ownerUid: user.uid, seasonId: currentSeasonId,
        });
        const ref2 = doc(collection(db, 'fixtures'));
        batch.set(ref2, {
          matchday: 2, homeId: away, awayId: home,
          homeName: getName(away), awayName: getName(home),
          homeScore: null, awayScore: null, status: 'pending',
          deadline: deadline2.toISOString().split('T')[0],
          competition: 'playoff', round: 'SF', ownerUid: user.uid, seasonId: currentSeasonId,
        });
      });

      await batch.commit();
      showToast("Semi-Final fixtures generated!");
    } catch (err) {
      console.error("SF generation failed", err);
      showToast(err instanceof Error ? err.message : "SF generation failed", 'error');
    } finally {
      setLoading(false);
    }
  };

  const generateFinal = async () => {
    if (!isAdmin || !user || !currentSeasonId) return;
    try {
      setLoading(true);
      const sfTies = getPlayoffTies('SF');
      if (sfTies.length < 2) throw new Error("Semi-Final fixtures not found.");

      // Get SF winners
      const sf1 = sfTies[0];
      const sf2 = sfTies[1];
      const sf1p1 = sf1[0].homeId, sf1p2 = sf1[0].awayId;
      const sf2p1 = sf2[0].homeId, sf2p2 = sf2[0].awayId;

      const fw1 = getPlayoffWinner(sf1p1, sf1p2, 'SF');
      const fw2 = getPlayoffWinner(sf2p1, sf2p2, 'SF');

      if (!fw1 || !fw2) throw new Error("Complete all Semi-Final matches first.");

      // Delete existing Final fixtures
      const batch = writeBatch(db);
      playoffFixtures.filter(f => f.round === 'F').forEach(f => batch.delete(doc(db, 'fixtures', f.id)));

      const today = new Date();
      const deadline1 = new Date(today); deadline1.setDate(today.getDate() + 7);
      const deadline2 = new Date(today); deadline2.setDate(today.getDate() + 14);

      const getName = (id: string) => {
        const p = allPlayers.find(pl => pl.id === id);
        return p?.name || tableData.find(t => t.id === id)?.name || id;
      };

      const ref1 = doc(collection(db, 'fixtures'));
      batch.set(ref1, {
        matchday: 1, homeId: fw1, awayId: fw2,
        homeName: getName(fw1), awayName: getName(fw2),
        homeScore: null, awayScore: null, status: 'pending',
        deadline: deadline1.toISOString().split('T')[0],
        competition: 'playoff', round: 'F', ownerUid: user.uid, seasonId: currentSeasonId,
      });
      const ref2 = doc(collection(db, 'fixtures'));
      batch.set(ref2, {
        matchday: 2, homeId: fw2, awayId: fw1,
        homeName: getName(fw2), awayName: getName(fw1),
        homeScore: null, awayScore: null, status: 'pending',
        deadline: deadline2.toISOString().split('T')[0],
        competition: 'playoff', round: 'F', ownerUid: user.uid, seasonId: currentSeasonId,
      });

      await batch.commit();
      showToast("Final fixtures generated! 🏆");
    } catch (err) {
      console.error("Final generation failed", err);
      showToast(err instanceof Error ? err.message : "Final generation failed", 'error');
    } finally {
      setLoading(false);
    }
  };

  // Helper: get UEFA aggregate winner from 2-leg tie
  const getUefaTieWinner = (p1Id: string, p2Id: string, round: number): string | null => {
    const legs = uefaFixtures.filter(f =>
      f.matchday === round &&
      ((f.homeId === p1Id && f.awayId === p2Id) || (f.homeId === p2Id && f.awayId === p1Id))
    );
    if (legs.some(l => l.status !== 'played')) return null;
    let p1Goals = 0, p2Goals = 0;
    legs.forEach(f => {
      if (f.homeId === p1Id) { p1Goals += f.homeScore || 0; p2Goals += f.awayScore || 0; }
      else { p2Goals += f.homeScore || 0; p1Goals += f.awayScore || 0; }
    });
    if (p1Goals > p2Goals) return p1Id;
    if (p2Goals > p1Goals) return p2Id;
    return p1Id; // tie: higher seed advances
  };

  const generateUefaDraw = async (reset = false) => {
    if (!isAdmin || !user) return;
    try {
      setLoading(true);
      const batch = writeBatch(db);

      let playersToDraw: string[] = [];
      const activeTable = tableData.filter(p => p.p > 0);

      if (reset) {
        uefaFixtures.forEach(f => batch.delete(doc(db, 'fixtures', f.id)));
        if (activeTable.length < 8) throw new Error("Need at least 8 players with games played");
        const top6 = activeTable.slice(0, 6).map(p => p.id);
        if (activeTable.length >= 10) {
          const w1 = getPlayoffWinner(activeTable[6].id, activeTable[8].id);
          const w2 = getPlayoffWinner(activeTable[7].id, activeTable[9].id);
          if (!w1 || !w2) throw new Error("Playoff results not complete yet.");
          playersToDraw = [...top6, w1, w2];
        } else {
          playersToDraw = top6;
        }
      } else {
        const latestRound = uefaFixtures.length > 0 ? Math.max(...uefaFixtures.map(f => f.matchday)) : 0;

        if (latestRound === 0) {
          if (activeTable.length < 6) throw new Error("Need at least 6 players with games played");
          const top6 = activeTable.slice(0, 6).map(p => p.id);
          if (activeTable.length >= 10) {
            const w1 = getPlayoffWinner(activeTable[6].id, activeTable[8].id);
            const w2 = getPlayoffWinner(activeTable[7].id, activeTable[9].id);
            if (!w1 || !w2) throw new Error("Playoff results not complete yet.");
            playersToDraw = [...top6, w1, w2];
          } else {
            playersToDraw = top6;
          }
        } else {
          const currentRoundFixtures = uefaFixtures.filter(f => f.matchday === latestRound);
          const pending = currentRoundFixtures.filter(f => f.status !== 'played');
          if (pending.length > 0) throw new Error("Complete all current round matches first");

          // Get unique pairs from current round
          const pairs: { p1: string; p2: string }[] = [];
          const seen = new Set<string>();
          currentRoundFixtures.forEach(f => {
            const key = [f.homeId, f.awayId].sort().join('-');
            if (!seen.has(key)) {
              seen.add(key);
              pairs.push({ p1: f.homeId, p2: f.awayId });
            }
          });

          const isTwoLeg = currentRoundFixtures.length > pairs.length;
          if (isTwoLeg) {
            playersToDraw = pairs.map(({ p1, p2 }) => getUefaTieWinner(p1, p2, latestRound)).filter(Boolean) as string[];
          } else {
            // Single leg (final)
            playersToDraw = currentRoundFixtures.map(f => {
              if (f.homeScore! > f.awayScore!) return f.homeId;
              if (f.awayScore! > f.homeScore!) return f.awayId;
              return f.homeId;
            });
          }

          if (playersToDraw.length < 2) throw new Error("Tournament complete! We have a champion!");
        }
      }

      const nextRound = reset ? 1 : (uefaFixtures.length > 0 ? Math.max(...uefaFixtures.map(f => f.matchday)) + 1 : 1);
      const shuffled = [...playersToDraw].sort(() => Math.random() - 0.5);
      const today = new Date();
      const deadline1 = new Date(today); deadline1.setDate(today.getDate() + 7);
      const deadline2 = new Date(today); deadline2.setDate(today.getDate() + 14);

      // Final = 2 players left and round >= 3 → single game
      const isFinal = shuffled.length === 2 && nextRound >= 3;

      for (let i = 0; i < shuffled.length; i += 2) {
        const p1Id = shuffled[i];
        const p2Id = shuffled[i + 1];
        const p1 = allPlayers.find(p => p.id === p1Id)!;
        const p2 = p2Id ? allPlayers.find(p => p.id === p2Id)! : null;

        if (!p2Id) {
          batch.set(doc(collection(db, 'fixtures')), {
            matchday: nextRound, homeId: p1Id, awayId: 'BYE',
            homeName: p1.name, awayName: 'BYE',
            homeScore: 3, awayScore: 0, status: 'played',
            deadline: deadline1.toISOString().split('T')[0],
            competition: 'uefa', ownerUid: user.uid, seasonId: currentSeasonId
          });
        } else if (isFinal) {
          batch.set(doc(collection(db, 'fixtures')), {
            matchday: nextRound, homeId: p1Id, awayId: p2Id,
            homeName: p1.name, awayName: p2.name,
            homeScore: null, awayScore: null, status: 'pending',
            deadline: deadline1.toISOString().split('T')[0],
            competition: 'uefa', ownerUid: user.uid, seasonId: currentSeasonId
          });
        } else {
          // 2-leg tie
          batch.set(doc(collection(db, 'fixtures')), {
            matchday: nextRound, homeId: p1Id, awayId: p2Id,
            homeName: p1.name, awayName: p2.name,
            homeScore: null, awayScore: null, status: 'pending',
            deadline: deadline1.toISOString().split('T')[0],
            competition: 'uefa', ownerUid: user.uid, seasonId: currentSeasonId
          });
          batch.set(doc(collection(db, 'fixtures')), {
            matchday: nextRound, homeId: p2Id, awayId: p1Id,
            homeName: p2.name, awayName: p1.name,
            homeScore: null, awayScore: null, status: 'pending',
            deadline: deadline2.toISOString().split('T')[0],
            competition: 'uefa', ownerUid: user.uid, seasonId: currentSeasonId
          });
        }
      }

      await batch.commit();
      showToast(reset ? "UEFA Tournament Reset!" : isFinal ? "The Grand Final is set!" : "Next Round Drawn — 2 legs per tie!");
    } catch (err) {
      console.error("Draw failed", err);
      showToast(err instanceof Error ? err.message : "Draw failed", 'error');
    } finally {
      setLoading(false);
    }
  };

  const addPlayer = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user) return;
    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;
    const club = formData.get('club') as string;
    const bio = formData.get('bio') as string;

    try {
      await addDoc(collection(db, 'players'), {
        name,
        club,
        bio: bio || '',
        ownerUid: user.uid,
        createdAt: serverTimestamp()
      });
      (e.target as HTMLFormElement).reset();
      showToast("Player added!");
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'players');
    }
  };

  const deletePlayer = async (id: string) => {
    if (!user) return;
    const isOwner = players.some(p => p.id === id);
    if (!isOwner && !isAdmin) return;
    
    if (isAdmin && !window.confirm("Are you sure you want to delete this player? This will also affect their fixtures.")) return;
    
    try {
      await deleteDoc(doc(db, 'players', id));
      showToast("Player removed");
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'players');
    }
  };

  const updatePlayerBio = async () => {
    if (!selectedPlayer || !user) return;
    try {
      const playerRef = doc(db, 'players', selectedPlayer.id);
      await updateDoc(playerRef, { bio: playerBio });
      showToast("Profile updated!");
      setShowPlayerModal(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `players/${selectedPlayer.id}`);
    }
  };

  const startAuction = async (player: Player, startingBid: number) => {
    if (!user) return;
    try {
      const auctionRef = doc(collection(db, 'auctions'));
      const endTime = new Date();
      endTime.setHours(endTime.getHours() + 24); // 24 hour auction

      await setDoc(auctionRef, {
        id: auctionRef.id,
        playerId: player.id,
        playerName: player.name,
        sellerUid: user.uid,
        currentBid: startingBid,
        endTime: endTime.toISOString(),
        status: 'active'
      });
      showToast("Auction started!");
      setShowAuctionModal(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'auctions');
    }
  };

  const placeBid = async (auction: Auction, amount: number) => {
    if (!user) return;
    if (auction.sellerUid === user?.uid) {
      showToast("You cannot bid on your own player", "error");
      return;
    }

    if (amount <= auction.currentBid) {
      showToast("Bid must be higher than current bid", 'error');
      return;
    }
    if (amount > userBudget) {
      showToast("Insufficient budget", 'error');
      return;
    }

    try {
      await updateDoc(doc(db, 'auctions', auction.id), {
        currentBid: amount,
        highestBidderUid: user.uid,
        highestBidderName: user.displayName || 'Anonymous'
      });
      showToast("Bid placed!");
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `auctions/${auction.id}`);
    }
  };

  const completeAuction = async (auction: Auction) => {
    if (!user) return;
    if (auction.status !== 'active') return;

    try {
      const batch = writeBatch(db);
      
      if (auction.highestBidderUid) {
        // Transfer player
        batch.update(doc(db, 'players', auction.playerId), {
          ownerUid: auction.highestBidderUid,
          value: auction.currentBid
        });

        // Update buyer budget
        const buyerRef = doc(db, 'users', auction.highestBidderUid);
        const buyerSnap = await getDoc(buyerRef);
        if (buyerSnap.exists()) {
          batch.update(buyerRef, {
            budget: (buyerSnap.data().budget || 100) - auction.currentBid
          });
        }

        // Update seller budget
        const sellerRef = doc(db, 'users', auction.sellerUid);
        const sellerSnap = await getDoc(sellerRef);
        if (sellerSnap.exists()) {
          batch.update(sellerRef, {
            budget: (sellerSnap.data().budget || 100) + auction.currentBid
          });
        }
      }

      batch.update(doc(db, 'auctions', auction.id), { status: 'completed' });
      await batch.commit();
      showToast("Auction completed!");
    } catch (err) {
      console.error("Failed to complete auction", err);
      showToast("Failed to complete auction", 'error');
    }
  };

  const addNews = async () => {
    if (!isAdmin || !newNews.title || !newNews.content) return;
    try {
      await addDoc(collection(db, 'news'), {
        ...newNews,
        authorUid: user?.uid,
        authorName: user?.displayName,
        createdAt: serverTimestamp()
      });
      setNewNews({ title: '', content: '', imageUrl: '' });
      setShowNewsModal(false);
      showToast("News posted!");
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'news');
    }
  };

  const updateNews = async () => {
    if (!isAdmin || !editingNews) return;
    try {
      await updateDoc(doc(db, 'news', editingNews.id), {
        title: newNews.title,
        content: newNews.content,
        imageUrl: newNews.imageUrl
      });
      setEditingNews(null);
      setNewNews({ title: '', content: '', imageUrl: '' });
      setShowNewsModal(false);
      showToast("News updated!");
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `news/${editingNews.id}`);
    }
  };

  const deleteNews = async (id: string) => {
    if (!isAdmin) return;
    if (!window.confirm("Delete this article?")) return;
    try {
      await deleteDoc(doc(db, 'news', id));
      showToast("News deleted");
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `news/${id}`);
    }
  };

  const addComment = async (fixtureId: string) => {
    if (!newComment.trim() || !user) return;
    try {
      await addDoc(collection(db, 'comments'), {
        fixtureId,
        text: newComment,
        authorUid: user.uid,
        authorName: user.displayName,
        authorPhoto: user.photoURL,
        createdAt: serverTimestamp()
      });
      setNewComment('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'comments');
    }
  };

  const deleteComment = async (id: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'comments', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `comments/${id}`);
    }
  };

  const shareToWhatsApp = (fixture: Fixture) => {
    if (fixture.status !== 'played') return;
    const message = `${fixture.homeName} just humbled ${fixture.awayName} ${fixture.homeScore}-${fixture.awayScore}! 🏆 SHATTA MOVEMENT LEAGUE`;
    const url = `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
  };

  const toggleAdmin = async (targetUser: any) => {
    if (!isAdmin || targetUser.uid === user?.uid) return;
    try {
      const newRole = targetUser.role === 'admin' ? 'user' : 'admin';
      await updateDoc(doc(db, 'users', targetUser.uid), { role: newRole });
      showToast(`Updated ${targetUser.displayName || targetUser.email} to ${newRole}`);
    } catch (err) {
      console.error("Failed to toggle admin", err);
      showToast("Failed to update role", 'error');
    }
  };

  const saveChampion = async () => {
    if (!newChampion.season || !newChampion.winner) return showToast('Season and winner are required', 'error');
    try {
      const ref = doc(db, 'config', 'champions');
      let updated: Champion[];
      if (editingChampion !== null) {
        updated = [...champions];
        updated[editingChampion] = newChampion;
      } else {
        updated = [...champions, newChampion];
      }
      await setDoc(ref, { list: updated }, { merge: true });
      setNewChampion({ season: '', winner: '', runnerUp: '', year: '' });
      setEditingChampion(null);
      showToast(editingChampion !== null ? 'Champion updated!' : 'Champion added!');
    } catch (err) {
      console.error("Failed to save champion", err);
      showToast('Failed to save champion', 'error');
    }
  };

  const removeChampion = async (index: number) => {
    try {
      const ref = doc(db, 'config', 'champions');
      const updated = champions.filter((_, i) => i !== index);
      await setDoc(ref, { list: updated }, { merge: true });
      showToast('Champion removed');
    } catch (err) {
      showToast('Failed to remove champion', 'error');
    }
  };

  const addAdminEmail = async () => {
    const email = newAdminEmail.toLowerCase().trim();
    if (!email || !email.includes('@')) return showToast('Enter a valid email', 'error');
    if (adminEmails.includes(email)) return showToast('Email already an admin', 'error');
    try {
      const ref = doc(db, 'config', 'adminEmails');
      await setDoc(ref, { emails: [...adminEmails, email] }, { merge: true });
      setNewAdminEmail('');
      showToast(`${email} added as admin`);
    } catch (err) {
      console.error("Failed to add admin email", err);
      showToast('Failed to add admin email', 'error');
    }
  };

  const removeAdminEmail = async (email: string) => {
    try {
      const ref = doc(db, 'config', 'adminEmails');
      await setDoc(ref, { emails: adminEmails.filter(e => e !== email) }, { merge: true });
      showToast(`${email} removed from admins`);
    } catch (err) {
      console.error("Failed to remove admin email", err);
      showToast('Failed to remove admin email', 'error');
    }
  };

  const resetLeague = async () => {
    if (!isAdmin || !window.confirm("WARNING: This will delete ALL fixtures and results. Proceed?")) return;
    try {
      setLoading(true);
      const batch = writeBatch(db);
      fixtures.forEach(f => batch.delete(doc(db, 'fixtures', f.id)));
      uefaFixtures.forEach(f => batch.delete(doc(db, 'fixtures', f.id)));
      playoffFixtures.forEach(f => batch.delete(doc(db, 'fixtures', f.id)));
      await batch.commit();
      showToast("League reset successfully");
    } catch (err) {
      console.error("Reset failed", err);
      showToast("Reset failed", 'error');
    } finally {
      setLoading(false);
    }
  };

  const bulkUploadResults = async () => {
    if (!isAdmin || !bulkResultsText.trim()) return;
    try {
      const lines = bulkResultsText.split('\n').map(l => l.trim()).filter(l => l !== '');
      const batch = writeBatch(db);
      let count = 0;

      lines.forEach(line => {
        // Regex to match "Team Name 1-2 Other Team" or "Team Name 1 - 2 Other Team"
        const match = line.match(/^(.+?)\s+(\d+)\s*-\s*(\d+)\s+(.+)$/i);
        if (match) {
          const [, homeName, homeScore, awayScore, awayName] = match;
          const fixture = fixtures.find(f => 
            f.homeName.toLowerCase() === homeName.toLowerCase() && 
            f.awayName.toLowerCase() === awayName.toLowerCase() &&
            f.status !== 'played'
          );
          if (fixture) {
            batch.update(doc(db, 'fixtures', fixture.id), {
              homeScore: parseInt(homeScore),
              awayScore: parseInt(awayScore),
              status: 'played'
            });
            // Auto-generate match report in background
            generateMatchReport(fixture, parseInt(homeScore), parseInt(awayScore));
            count++;
          }
        }
      });

      if (count === 0) {
        showToast("No matching pending fixtures found", 'error');
        return;
      }

      await batch.commit();
      setBulkResultsText('');
      showToast(`Successfully updated ${count} results!`);
    } catch (err) {
      console.error("Bulk upload failed", err);
      showToast("Bulk upload failed", 'error');
    }
  };

  const generateMatchReport = async (fixture: Fixture, homeScore: number, awayScore: number) => {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
      const model = ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Generate a funny, roast-style match report for a FIFA league.
        Match: ${fixture.homeName} vs ${fixture.awayName}
        Score: ${homeScore} - ${awayScore}
        
        The report should have a catchy title and a short, hilarious summary that roasts the loser and praises the winner (or roasts both if it's a boring draw). Use slang and banter common in football communities. Keep it under 150 words.
        Return the result as a JSON object with "title" and "content" fields.`,
        config: {
          responseMimeType: "application/json"
        }
      });

      const result = await model;
      const report = JSON.parse(result.text);

      await addDoc(collection(db, 'news'), {
        title: report.title,
        content: report.content,
        authorUid: 'system',
        authorName: 'League Reporter',
        createdAt: serverTimestamp(),
        imageUrl: `https://picsum.photos/seed/${fixture.id}/800/450`
      });
    } catch (err) {
      console.error("Failed to generate match report", err);
    }
  };

  const submitPlayoffScore = async (fixtureId: string) => {
    if (!user || !isAdmin) return;
    try {
      await updateDoc(doc(db, 'fixtures', fixtureId), {
        homeScore: playoffScores.home,
        awayScore: playoffScores.away,
        status: 'played'
      });
      setPlayoffEditingFixture(null);
      showToast("Playoff score updated!");
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'fixtures');
    }
  };

  const submitH2hScore = async (fixtureId: string) => {
    if (!user || !isAdmin) return;
    try {
      await updateDoc(doc(db, 'fixtures', fixtureId), {
        homeScore: h2hScores.home,
        awayScore: h2hScores.away,
        status: 'played'
      });
      setH2hEditingFixture(null);
      showToast("Score updated!");
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'fixtures');
    }
  };

  const submitScore = async () => {
    if (!selectedFixture || !user) return;
    try {
      await updateDoc(doc(db, 'fixtures', selectedFixture.id), {
        homeScore: scores.home,
        awayScore: scores.away,
        status: 'played'
      });
      
      // Auto-generate match report
      generateMatchReport(selectedFixture, scores.home, scores.away);
      
      setShowModal(false);
      showToast("Score updated!");
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'fixtures');
    }
  };

  const addBulkPlayers = async () => {
    if (!bulkText.trim() || !user) return;
    try {
      const names = bulkText.split('\n').map(n => n.trim()).filter(n => n !== '');
      const batch = writeBatch(db);
      names.forEach(name => {
        const newPlayerRef = doc(collection(db, 'players'));
        batch.set(newPlayerRef, {
          name,
          club: 'TBD',
          ownerUid: user.uid,
          createdAt: serverTimestamp()
        });
      });
      await batch.commit();
      setBulkText('');
      showToast(`Imported ${names.length} players!`);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'players');
    }
  };

  const clearAllPlayers = async () => {
    if (!user || !window.confirm("Are you sure you want to clear ALL players and their fixtures?")) return;
    try {
      const batch = writeBatch(db);
      players.forEach(p => batch.delete(doc(db, 'players', p.id)));
      fixtures.forEach(f => batch.delete(doc(db, 'fixtures', f.id)));
      uefaFixtures.forEach(f => batch.delete(doc(db, 'fixtures', f.id)));
      playoffFixtures.forEach(f => batch.delete(doc(db, 'fixtures', f.id)));
      await batch.commit();
      showToast("All data cleared");
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'players');
    }
  };

  const shareTable = () => {
    const text = `🏆 SHATTA MOVEMENT LEAGUE Standings\n\n` + 
      tableData.map((p, i) => `${i+1}. ${p.name} - ${p.pts}pts (${p.w}W ${p.d}D ${p.l}L)`).join('\n');
    navigator.clipboard.writeText(text);
    showToast("Table copied to clipboard!");
  };

  const uniquePlayers = useMemo(() => {
    const seen = new Set<string>();
    return allPlayers.filter(p => {
      if (seen.has(p.name)) return false;
      seen.add(p.name);
      return true;
    });
  }, [allPlayers]);



  const tableData = useMemo<TableRow[]>(() => {
    const stats: Record<string, TableRow> = {};
    allPlayers.forEach(p => {
      stats[p.id] = {
        id: p.id,
        name: p.name,
        club: p.club,
        p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0,
        form: []
      };
    });

    allFixtures.filter(f => f.competition === 'league' && f.status === 'played' && f.seasonId === currentSeasonId).forEach(f => {
      const h = stats[f.homeId];
      const a = stats[f.awayId];
      if (!h || !a) return;

      h.p++; a.p++;
      h.gf += f.homeScore || 0; h.ga += f.awayScore || 0;
      a.gf += f.awayScore || 0; a.ga += f.homeScore || 0;

      if ((f.homeScore || 0) > (f.awayScore || 0)) {
        h.w++; h.pts += 3; a.l++;
        h.form.unshift('W'); a.form.unshift('L');
      } else if ((f.homeScore || 0) < (f.awayScore || 0)) {
        a.w++; a.pts += 3; h.l++;
        h.form.unshift('L'); a.form.unshift('W');
      } else {
        h.d++; h.pts += 1; a.d++; a.pts += 1;
        h.form.unshift('D'); a.form.unshift('D');
      }
    });

    // Merge stats for duplicate player names
    const merged: Record<string, TableRow> = {};
    Object.values(stats).forEach(row => {
      if (merged[row.name]) {
        const m = merged[row.name];
        m.p += row.p; m.w += row.w; m.d += row.d; m.l += row.l;
        m.gf += row.gf; m.ga += row.ga; m.pts += row.pts;
        m.form = [...m.form, ...row.form];
      } else {
        merged[row.name] = { ...row };
      }
    });

    return Object.values(merged).map(p => ({
      ...p,
      form: p.form.slice(0, 5)
    })).sort((a, b) =>
      b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf || a.name.localeCompare(b.name)
    );
  }, [allPlayers, allFixtures, currentSeasonId]);

  if (loading || !isAuthReady) return <div className="flex items-center justify-center h-screen font-display text-2xl animate-pulse">LOADING...</div>;

  if (!user && !isGuest) {
    return (
      <div className="min-h-screen bg-pl-ink text-white flex items-center justify-center p-6 font-sans">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="glass p-10 rounded-3xl w-full max-w-md border border-white/5 shadow-2xl relative overflow-hidden"
        >
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-pl-cyan via-pl-pink to-pl-purple" />
          
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-white/5 rounded-2xl mb-6 border border-white/10">
              <Trophy className="text-pl-cyan" size={40} />
            </div>
            <h1 className="font-display text-4xl uppercase tracking-wider mb-2">Shatta <span className="text-pl-cyan">League</span></h1>
            <p className="text-white/40 font-condensed uppercase tracking-widest text-xs">Season 2025/26 • {isAdminLoginMode ? 'Admin Portal' : 'Player Portal'}</p>
          </div>

          {!isAdminLoginMode ? (
            <div className="space-y-6">
              <button
                onClick={() => {
                  setIsGuest(true);
                  showToast("Welcome to the League!");
                }}
                className="w-full bg-pl-cyan text-pl-ink py-5 rounded-xl font-display text-sm uppercase tracking-widest hover:brightness-110 transition-all shadow-[0_0_20px_rgba(0,255,249,0.3)]"
              >
                Enter League
              </button>
              <p className="text-[10px] text-center text-white/40 uppercase tracking-widest leading-relaxed">
                View the league table, fixtures, and standings
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              <button 
                onClick={() => loginWithGoogle().catch(err => {
                  console.error("Google Login Error:", err);
                  setAuthError(err.message);
                })}
                className="w-full bg-white text-pl-ink py-5 rounded-xl font-display text-sm uppercase tracking-widest flex items-center justify-center gap-4 hover:bg-white/90 transition-all shadow-xl"
              >
                <img src="https://www.google.com/favicon.ico" alt="" className="w-5 h-5" />
                Sign in with Google
              </button>
              <p className="text-[10px] text-center text-white/40 uppercase tracking-widest leading-relaxed">
                Google login is reserved for <span className="text-pl-cyan">League Administrators</span>.
              </p>
            </div>
          )}

          <div className="mt-8 pt-8 border-t border-white/5 flex flex-col gap-4 text-center">
            <button 
              onClick={() => setIsAdminLoginMode(!isAdminLoginMode)}
              className="text-[10px] font-condensed text-pl-cyan/60 uppercase tracking-widest hover:text-pl-cyan transition-colors flex items-center justify-center gap-2"
            >
              {isAdminLoginMode ? (
                <>
                  <UserIcon size={12} />
                  Back to Player Login
                </>
              ) : (
                <>
                  <ShieldCheck size={12} />
                  Admin Portal
                </>
              )}
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Hero Section */}
      <header className="pl-gradient border-b-4 border-pl-pink relative overflow-hidden">
        <div className="absolute inset-0 opacity-10 pointer-events-none" 
             style={{ backgroundImage: 'repeating-linear-gradient(-45deg, transparent, transparent 20px, white 20px, white 21px)' }} />
        
        <div className="max-w-5xl mx-auto px-6 py-12 text-center relative z-10">
          <div className="flex justify-center items-center gap-4 mb-8">
            <div className="flex items-center gap-3 glass px-4 py-2 rounded-full">
              <div className="w-6 h-6 rounded-full border border-white/20 bg-pl-pink flex items-center justify-center text-[10px] font-bold">
                {user?.photoURL ? <img src={user.photoURL} alt="" className="w-full h-full rounded-full" /> : (user?.displayName?.[0] || 'G')}
              </div>
              <span className="text-[10px] font-condensed font-bold text-white/60 uppercase tracking-widest">{user?.displayName || 'Guest Viewer'}</span>
              <div className="w-px h-3 bg-white/10 mx-1" />
              <span className="text-[10px] font-condensed font-bold text-pl-cyan uppercase tracking-widest">£{userBudget}M</span>
              <button onClick={() => { logout(); setIsGuest(false); }} className="text-white/20 hover:text-pl-pink transition-colors">
                <LogOut size={14} />
              </button>
            </div>
          </div>

          <h1 className="font-display text-6xl md:text-8xl font-bold uppercase leading-[0.9] tracking-tight mb-2">
            {champions.length > 0 ? champions[champions.length - 1].winner : 'SHATTA MOVEMENT'}{' '}
            <span className="text-pl-cyan">LEAGUE</span>
          </h1>
          {seasons.find(s => s.id === currentSeasonId) && (() => {
            const sName = seasons.find(s => s.id === currentSeasonId)!.name;
            const displayName = /season/i.test(sName) ? sName : `Season ${sName}`;
            return (
              <div className="font-condensed text-base md:text-lg text-pl-cyan/70 uppercase tracking-[0.4em] mb-2">
                {displayName}
              </div>
            );
          })()}
          {champions.length > 0 && (
            <div className="relative my-6">
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-yellow-400/10 to-transparent rounded-2xl blur-xl" />
              <div className="relative glass border-2 border-yellow-400/40 rounded-2xl px-8 py-6 flex flex-col items-center gap-3 shadow-[0_0_40px_rgba(250,204,21,0.15)]">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-yellow-400/20 rounded-full flex items-center justify-center">
                    <Trophy className="text-yellow-400" size={28} />
                  </div>
                  <span className="text-lg md:text-xl font-condensed font-bold text-yellow-400 uppercase tracking-[0.3em]">
                    Reigning Champion
                  </span>
                  <div className="w-12 h-12 bg-yellow-400/20 rounded-full flex items-center justify-center">
                    <Trophy className="text-yellow-400" size={28} />
                  </div>
                </div>
                <div className="font-display text-4xl md:text-6xl text-yellow-400 uppercase tracking-wider drop-shadow-[0_0_15px_rgba(250,204,21,0.4)]">
                  {champions[champions.length - 1].winner}
                </div>
                <div className="h-px w-32 bg-gradient-to-r from-transparent via-yellow-400/50 to-transparent" />
                <span className="text-[10px] font-condensed text-yellow-400/40 uppercase tracking-[0.3em]">
                  {champions[champions.length - 1].season}{champions[champions.length - 1].year ? ` • ${champions[champions.length - 1].year}` : ''}
                </span>
              </div>
            </div>
          )}
          
          <div className="flex justify-center max-w-md mx-auto glass rounded-lg divide-x divide-white/10 mt-8">
            <div className="flex-1 py-4">
              <div className="font-display text-2xl text-pl-cyan leading-none">{uniquePlayers.length}</div>
              <div className="font-condensed text-[10px] text-white/40 tracking-widest uppercase mt-1">Players</div>
            </div>
            <div className="flex-1 py-4">
              <div className="font-display text-2xl text-pl-cyan leading-none">{fixtures.length + uefaFixtures.length}</div>
              <div className="font-condensed text-[10px] text-white/40 tracking-widest uppercase mt-1">Fixtures</div>
            </div>
            <div className="flex-1 py-4">
              <div className="font-display text-2xl text-pl-cyan leading-none">
                {fixtures.filter(f => f.status === 'played').length + uefaFixtures.filter(f => f.status === 'played').length}
              </div>
              <div className="font-condensed text-[10px] text-white/40 tracking-widest uppercase mt-1">Played</div>
            </div>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="sticky top-0 z-50 bg-pl-ink/95 backdrop-blur-xl border-b border-white/5">
        <div className="relative max-w-5xl mx-auto">
          {canScrollLeft && (
            <button
              onClick={() => scrollTabs('left')}
              className="absolute left-0 top-0 bottom-0 z-10 w-10 flex items-center justify-center bg-gradient-to-r from-pl-ink via-pl-ink/90 to-transparent"
            >
              <ChevronLeft size={18} className="text-pl-cyan" />
            </button>
          )}
          <div ref={tabsRef} className="px-4 flex overflow-x-auto no-scrollbar">
            {[
              { id: 'table', icon: Trophy, label: 'Table', public: true },
              { id: 'fixtures', icon: Calendar, label: 'Fixtures', public: true },
              { id: 'h2h', icon: Swords, label: 'H2H', public: true },
              { id: 'market', icon: MessageSquare, label: 'Market', public: true },
              { id: 'rules', icon: ShieldCheck, label: 'Rules', public: true },
              { id: 'players', icon: Users, label: 'Squad', public: true },
              { id: 'playoff', icon: Swords, label: 'Playoffs', public: true },
              { id: 'uefa', icon: Trophy, label: 'UEFA', public: true },
              { id: 'halloffame', icon: Trophy, label: 'Hall of Fame', public: true },
              { id: 'wc', icon: Trophy, label: 'WC', public: true },
              { id: 'admin', icon: ShieldCheck, label: 'Admin', public: false },
            ].filter(t => isAdmin || t.public).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as Tab)}
                className={`flex items-center gap-2 px-6 py-4 font-condensed font-bold text-xs tracking-widest uppercase transition-all border-b-2 whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'text-pl-cyan border-pl-cyan'
                    : 'text-white/40 border-transparent hover:text-white/70'
                }`}
              >
                <tab.icon size={14} />
                {tab.label}
              </button>
            ))}
          </div>
          {canScrollRight && (
            <button
              onClick={() => scrollTabs('right')}
              className="absolute right-0 top-0 bottom-0 z-10 w-10 flex items-center justify-center bg-gradient-to-l from-pl-ink via-pl-ink/90 to-transparent"
            >
              <ChevronRight size={18} className="text-pl-cyan" />
            </button>
          )}
        </div>
      </nav>

      {isAdmin && selectedUserUid !== user?.uid && (
        <div className="bg-pl-pink text-white py-2 px-4 text-center text-[10px] font-bold uppercase tracking-widest sticky top-[53px] z-40">
          Viewing data for: {allUsers.find(u => u.uid === selectedUserUid)?.displayName || allUsers.find(u => u.uid === selectedUserUid)?.email}
          <button 
            onClick={() => setSelectedUserUid(user?.uid || null)}
            className="ml-4 underline hover:no-underline"
          >
            Return to my account
          </button>
        </div>
      )}

      <main className="flex-grow max-w-5xl mx-auto w-full px-6 py-10">
        <AnimatePresence mode="wait">
          {activeTab === 'table' && (
            <motion.div
              key="table"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-display text-2xl uppercase tracking-wider flex items-center gap-3">
                  League <span className="text-pl-pink">Table</span>
                </h2>
                <div className="flex items-center gap-4">
                  <button 
                    onClick={shareTable}
                    className="flex items-center gap-2 text-[10px] font-condensed font-bold text-pl-cyan uppercase tracking-widest hover:text-white transition-colors"
                  >
                    <Share2 size={12} /> Share Table
                  </button>
                  <div className="text-[10px] font-condensed font-bold text-white/40 uppercase tracking-widest">
                    Live Standings
                  </div>
                </div>
              </div>

              <div className="glass rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-pl-purple/50 font-condensed text-[10px] text-white/40 uppercase tracking-widest">
                        <th className="px-6 py-4 w-12 text-center">#</th>
                        <th className="px-6 py-4">Player</th>
                        <th className="px-4 py-4 text-center">P</th>
                        <th className="px-4 py-4 text-center">W</th>
                        <th className="px-4 py-4 text-center">D</th>
                        <th className="px-4 py-4 text-center">L</th>
                        <th className="px-4 py-4 text-center">GD</th>
                        <th className="px-6 py-4 text-center text-pl-cyan">PTS</th>
                        <th className="px-6 py-4 text-center">Form</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {tableData.map((row, i) => {
                        const gd = row.gf - row.ga;
                        const isCurrentUser = false;
                        return (
                          <tr key={row.id} className={`transition-colors group ${isCurrentUser ? 'bg-pl-cyan/10 border-l-4 border-pl-cyan' : 'hover:bg-white/5 border-l-4 border-transparent'}`}>
                            <td className={`px-6 py-5 text-center font-display text-lg ${i < 3 ? 'text-pl-cyan' : 'text-white/40'}`}>
                              {i + 1}
                            </td>
                            <td className="px-6 py-5">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded bg-pl-pink flex items-center justify-center font-display text-xl">
                                  {row.name[0]}
                                </div>
                                <div>
                                  <div className="flex items-center gap-2">
                                    <div className="font-bold text-sm">{row.name}</div>
                                    {isCurrentUser && (
                                      <span className="bg-pl-cyan text-pl-ink text-[8px] font-bold px-1.5 py-0.5 rounded uppercase tracking-tighter">YOU</span>
                                    )}
                                  </div>
                                  {/* Club display removed */}
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-5 text-center font-display">{row.p}</td>
                            <td className="px-4 py-5 text-center text-green-400 font-display">{row.w}</td>
                            <td className="px-4 py-5 text-center text-white/40 font-display">{row.d}</td>
                            <td className="px-4 py-5 text-center text-red-400 font-display">{row.l}</td>
                            <td className={`px-4 py-5 text-center font-display ${gd > 0 ? 'text-green-400' : gd < 0 ? 'text-red-400' : ''}`}>
                              {gd > 0 ? '+' : ''}{gd}
                            </td>
                            <td className="px-6 py-5 text-center font-display text-xl text-pl-cyan">{row.pts}</td>
                            <td className="px-6 py-5">
                              <div className="flex gap-1 justify-center">
                                {row.form.slice(-5).map((r: string, idx: number) => (
                                  <div key={idx} className={`w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold ${
                                    r === 'W' ? 'bg-green-500' : r === 'L' ? 'bg-red-500' : 'bg-white/20'
                                  }`}>
                                    {r}
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'uefa' && (
            <motion.div
              key="uefa"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-pl-cyan flex items-center justify-center text-pl-ink">
                    <Trophy size={24} />
                  </div>
                  <div>
                    <h2 className="font-display text-2xl uppercase tracking-wider">
                      UEFA <span className="text-pl-cyan">Ultimate</span> League
                    </h2>
                    <p className="text-[10px] font-condensed text-white/40 uppercase tracking-widest">Side Competition • Ultimate Teams</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  {isAdmin && (
                    <>
                      <button 
                        onClick={generatePlayoffs}
                        className="bg-pl-purple text-white px-4 py-2 rounded font-condensed font-bold text-xs uppercase tracking-widest hover:scale-105 transition-transform flex items-center gap-2"
                      >
                        <Swords size={14} /> Generate QF
                      </button>
                      <button 
                        onClick={() => generateUefaDraw(true)}
                        className="bg-white/5 text-white/40 px-4 py-2 rounded font-condensed font-bold text-xs uppercase tracking-widest hover:bg-white/10 transition-all"
                      >
                        Reset Tournament
                      </button>
                      <button 
                        onClick={() => generateUefaDraw(false)}
                        className="bg-pl-cyan text-pl-ink px-4 py-2 rounded font-condensed font-bold text-xs uppercase tracking-widest hover:scale-105 transition-transform flex items-center gap-2"
                      >
                        <Swords size={14} /> {uefaFixtures.length === 0 ? 'Initiate Draw' : 'Next Round'}
                      </button>
                    </>
                  )}
                </div>
              </div>

              {uefaFixtures.length === 0 ? (
                <div className="text-center py-20 glass rounded-xl">
                  <Trophy className="mx-auto text-white/10 mb-4" size={48} />
                  <p className="text-white/40 font-condensed tracking-widest uppercase">No UEFA matches in this season</p>
                </div>
              ) : (
                <div className="space-y-10">
                  {Array.from(new Set(uefaFixtures.map(f => f.matchday))).sort((a, b) => (a as number) - (b as number)).map(md => {
                    const roundFixtures = uefaFixtures.filter(f => f.matchday === md);
                    // Group into ties (unique pairs)
                    const ties: { p1: string; p2: string; p1Name: string; p2Name: string; legs: Fixture[] }[] = [];
                    const seen = new Set<string>();
                    roundFixtures.forEach(f => {
                      if (f.awayId === 'BYE') {
                        ties.push({ p1: f.homeId, p2: 'BYE', p1Name: f.homeName, p2Name: 'BYE', legs: [f] });
                        return;
                      }
                      const key = [f.homeId, f.awayId].sort().join('-');
                      if (!seen.has(key)) {
                        seen.add(key);
                        const matchLegs = roundFixtures.filter(g =>
                          (g.homeId === f.homeId && g.awayId === f.awayId) ||
                          (g.homeId === f.awayId && g.awayId === f.homeId)
                        ).sort((a, b) => (a.deadline || '').localeCompare(b.deadline || ''));
                        ties.push({ p1: f.homeId, p2: f.awayId, p1Name: f.homeName, p2Name: f.awayName, legs: matchLegs });
                      }
                    });
                    const isSingleLeg = ties.every(t => t.legs.length === 1);

                    return (
                    <div key={md} className="space-y-6">
                      <div className="flex items-center gap-4">
                        <div className="h-px flex-grow bg-pl-cyan/30"></div>
                        <h3 className="font-condensed font-bold text-sm uppercase tracking-[0.3em] text-pl-cyan">
                          {md === 1 ? 'Quarter Finals' :
                           md === 2 ? 'Semi Finals' :
                           'The Grand Final'}
                        </h3>
                        <div className="h-px flex-grow bg-pl-cyan/30"></div>
                      </div>

                      <div className="grid gap-6">
                        {ties.map((tie, ti) => {
                          if (tie.p2 === 'BYE') {
                            return (
                              <div key={ti} className="glass rounded-xl p-4 border-l-4 border-pl-cyan/20 opacity-50">
                                <div className="flex items-center justify-center gap-4">
                                  <span className="font-bold">{tie.p1Name}</span>
                                  <span className="bg-pl-cyan/10 text-pl-cyan px-4 py-1 rounded-full font-condensed font-bold text-[10px] uppercase tracking-widest">Bye — Advanced</span>
                                </div>
                              </div>
                            );
                          }

                          // Calculate aggregate for 2-leg ties
                          let p1Agg = 0, p2Agg = 0;
                          tie.legs.forEach(f => {
                            if (f.status === 'played') {
                              if (f.homeId === tie.p1) { p1Agg += f.homeScore || 0; p2Agg += f.awayScore || 0; }
                              else { p2Agg += f.homeScore || 0; p1Agg += f.awayScore || 0; }
                            }
                          });
                          const allPlayed = tie.legs.every(l => l.status === 'played');
                          const winner = allPlayed ? (p1Agg > p2Agg ? tie.p1Name : p2Agg > p1Agg ? tie.p2Name : tie.p1Name + ' (higher seed)') : null;

                          return (
                            <div key={ti} className="glass rounded-xl p-6 border-l-4 border-pl-cyan/30 space-y-4">
                              {/* Tie header with aggregate */}
                              <div className="flex items-center justify-between">
                                <div className="font-bold text-lg">{tie.p1Name}</div>
                                <div className="text-center">
                                  {!isSingleLeg && (
                                    <>
                                      <div className="font-display text-2xl text-pl-cyan">
                                        {tie.legs.some(l => l.status === 'played') ? `${p1Agg} – ${p2Agg}` : '– vs –'}
                                      </div>
                                      <div className="text-[8px] font-condensed text-white/30 uppercase tracking-widest">Aggregate</div>
                                    </>
                                  )}
                                  {isSingleLeg && allPlayed && (
                                    <div className="font-display text-2xl text-pl-cyan">
                                      {tie.legs[0].homeScore} – {tie.legs[0].awayScore}
                                    </div>
                                  )}
                                  {winner && (
                                    <div className="mt-1 bg-emerald-400/20 text-emerald-400 text-[8px] font-bold uppercase tracking-widest px-3 py-1 rounded-full border border-emerald-400/30">
                                      {winner} advances
                                    </div>
                                  )}
                                </div>
                                <div className="font-bold text-lg text-right">{tie.p2Name}</div>
                              </div>

                              {/* Individual legs */}
                              {tie.legs.map((f, li) => (
                                <div key={f.id} className="bg-white/5 rounded-lg p-3 space-y-2">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-condensed text-white/40 uppercase tracking-widest">
                                      {isSingleLeg ? 'Final' : `Leg ${li + 1}`}
                                    </span>
                                    <div className="flex items-center gap-3">
                                      <span className="font-bold text-sm">{f.homeName}</span>
                                      <div className="flex items-center gap-2 bg-pl-ink/50 px-4 py-1 rounded-full">
                                        <span className="font-display text-lg w-6 text-center">{f.status === 'played' ? f.homeScore : '-'}</span>
                                        <span className="text-white/20 text-[8px]">VS</span>
                                        <span className="font-display text-lg w-6 text-center">{f.status === 'played' ? f.awayScore : '-'}</span>
                                      </div>
                                      <span className="font-bold text-sm">{f.awayName}</span>
                                    </div>
                                    <span className={`text-[8px] font-condensed font-bold uppercase tracking-widest px-2 py-1 rounded ${
                                      f.status === 'played' ? 'bg-green-500/10 text-green-400' : 'bg-white/5 text-white/30'
                                    }`}>
                                      {f.status === 'played' ? 'FT' : 'Pending'}
                                    </span>
                                  </div>

                                  {isAdmin && playoffEditingFixture === f.id ? (
                                    <div className="flex items-center justify-center gap-3 bg-pl-ink/50 p-3 rounded-lg border border-white/10">
                                      <span className="text-[10px] font-condensed text-white/40 uppercase tracking-widest">{f.homeName}</span>
                                      <input type="number" min="0" value={playoffScores.home}
                                        onChange={(e) => setPlayoffScores({ ...playoffScores, home: parseInt(e.target.value) || 0 })}
                                        className="w-14 bg-pl-ink border border-white/20 rounded-lg px-2 py-2 text-center font-display text-lg focus:border-emerald-400 outline-none"
                                      />
                                      <span className="text-white/20 font-condensed text-xs">-</span>
                                      <input type="number" min="0" value={playoffScores.away}
                                        onChange={(e) => setPlayoffScores({ ...playoffScores, away: parseInt(e.target.value) || 0 })}
                                        className="w-14 bg-pl-ink border border-white/20 rounded-lg px-2 py-2 text-center font-display text-lg focus:border-emerald-400 outline-none"
                                      />
                                      <span className="text-[10px] font-condensed text-white/40 uppercase tracking-widest">{f.awayName}</span>
                                      <button onClick={() => submitPlayoffScore(f.id)}
                                        className="bg-emerald-500 text-white px-4 py-2 rounded-lg font-condensed font-bold text-[10px] uppercase tracking-widest hover:brightness-110 transition-all">
                                        Save
                                      </button>
                                      <button onClick={() => setPlayoffEditingFixture(null)}
                                        className="bg-white/10 text-white/60 px-4 py-2 rounded-lg font-condensed font-bold text-[10px] uppercase tracking-widest hover:bg-white/20 transition-all">
                                        Cancel
                                      </button>
                                    </div>
                                  ) : isAdmin ? (
                                    <button
                                      onClick={() => { setPlayoffEditingFixture(f.id); setPlayoffScores({ home: f.homeScore ?? 0, away: f.awayScore ?? 0 }); }}
                                      className="w-full text-[10px] font-condensed text-emerald-400/60 uppercase tracking-widest hover:text-emerald-400 transition-colors text-center py-1">
                                      {f.status === 'played' ? 'Edit Score' : 'Enter Score'}
                                    </button>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          )}
          {activeTab === 'fixtures' && (
            <motion.div
              key="fixtures"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-display text-2xl uppercase tracking-wider">
                  Match <span className="text-pl-pink">Fixtures</span>
                </h2>
                <div className="flex gap-2">
                  {isAdmin && (
                    <>
                      <button 
                        onClick={() => setShowPreseasonModal(true)}
                        className="bg-pl-pink text-white px-4 py-2 rounded font-condensed font-bold text-xs uppercase tracking-widest hover:scale-105 transition-transform"
                      >
                        Add Preseason
                      </button>
                      <button 
                        onClick={generateSeason}
                        className="bg-pl-cyan text-pl-ink px-4 py-2 rounded font-condensed font-bold text-xs uppercase tracking-widest hover:scale-105 transition-transform"
                      >
                        Generate Season
                      </button>
                    </>
                  )}
                </div>
              </div>

              {fixtures.length === 0 && preseasonFixtures.length === 0 ? (
                <div className="text-center py-20 glass rounded-xl">
                  <Calendar className="mx-auto text-white/10 mb-4" size={48} />
                  <p className="text-white/40 font-condensed tracking-widest uppercase">No fixtures in this season</p>
                </div>
              ) : (
                <div className="space-y-12">
                  {/* Preseason Section */}
                  {preseasonFixtures.length > 0 && (
                    <div className="space-y-6">
                      <div className="flex items-center gap-4">
                        <div className="h-px w-8 bg-pl-pink/30"></div>
                        <h3 className="font-display text-lg uppercase tracking-widest text-pl-pink">Preseason Matches</h3>
                        <div className="h-px flex-grow bg-pl-pink/30"></div>
                      </div>
                      <div className="grid gap-3">
                        {preseasonFixtures.map(f => {
                          const isMyMatch = players.some(p => p.id === f.homeId || p.id === f.awayId);
                          return (
                            <div 
                              key={f.id}
                              onClick={() => {
                                setSelectedFixture(f);
                                setScores({ home: f.homeScore || 0, away: f.awayScore || 0 });
                                setShowModal(true);
                              }}
                              className={`glass transition-all rounded-lg p-4 flex items-center justify-between group border-l-4 cursor-pointer hover:bg-white/10 ${
                                isMyMatch ? 'border-pl-pink bg-pl-pink/5' : 'border-transparent'
                              }`}
                            >
                              <div className="flex-1 text-right font-bold pr-6 group-hover:text-pl-pink transition-colors">{f.homeName}</div>
                              <div className="flex items-center gap-4 bg-pl-ink/50 px-6 py-2 rounded-full border border-white/5">
                                <div className="font-display text-2xl w-8 text-center">
                                  {f.status === 'played' ? f.homeScore : '-'}
                                </div>
                                <div className="text-white/20 font-condensed text-[10px] uppercase tracking-widest">VS</div>
                                <div className="font-display text-2xl w-8 text-center">
                                  {f.status === 'played' ? f.awayScore : '-'}
                                </div>
                              </div>
                              <div className="flex-1 text-left font-bold pl-6 group-hover:text-pl-pink transition-colors">{f.awayName}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* League Section */}
                  {Array.from(new Set(fixtures.map(f => f.matchday))).sort((a, b) => (a as number) - (b as number)).map(md => (
                    <div key={md} className="space-y-4">
                      <div className="flex items-center gap-4">
                        <div className="h-px flex-grow bg-white/10"></div>
                        <h3 className="font-condensed font-bold text-xs uppercase tracking-[0.3em] text-pl-pink">Matchday {md}</h3>
                        <div className="h-px flex-grow bg-white/10"></div>
                      </div>
                      
                      <div className="grid gap-3">
                        {fixtures.filter(f => f.matchday === md).map(f => {
                          const isMyMatch = players.some(p => p.id === f.homeId || p.id === f.awayId);
                          return (
                            <div 
                              key={f.id}
                              onClick={() => {
                                setSelectedFixture(f);
                                setScores({ home: f.homeScore || 0, away: f.awayScore || 0 });
                                setShowModal(true);
                              }}
                              className={`glass transition-all rounded-lg p-4 flex items-center justify-between group border-l-4 cursor-pointer hover:bg-white/10 ${
                                isMyMatch ? 'border-pl-cyan bg-pl-cyan/5' : 'border-transparent'
                              }`}
                            >
                              <div className="flex-1 text-right font-bold pr-6 group-hover:text-pl-cyan transition-colors">{f.homeName}</div>
                              
                              <div className="flex items-center gap-4 bg-pl-ink/50 px-6 py-2 rounded-full border border-white/5">
                                <div className="font-display text-2xl w-8 text-center">
                                  {f.status === 'played' ? f.homeScore : '-'}
                                </div>
                                <div className="text-white/20 font-condensed text-[10px] uppercase tracking-widest">VS</div>
                                <div className="font-display text-2xl w-8 text-center">
                                  {f.status === 'played' ? f.awayScore : '-'}
                                </div>
                              </div>
                              
                              <div className="flex-1 text-left font-bold pl-6 group-hover:text-pl-cyan transition-colors">{f.awayName}</div>
                              
                              <div className="hidden md:flex flex-col items-end min-w-[100px] ml-4">
                                <div className="flex items-center gap-2 mb-1">
                                  {comments.filter(c => c.fixtureId === f.id).length > 0 && (
                                    <div className="flex items-center gap-1 text-[8px] text-pl-pink font-bold mr-2">
                                      <MessageSquare size={10} />
                                      {comments.filter(c => c.fixtureId === f.id).length}
                                    </div>
                                  )}
                                  {f.status === 'played' && (
                                    <button 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        shareToWhatsApp(f);
                                      }}
                                      className="p-1 text-emerald-500 hover:scale-110 transition-transform"
                                      title="Share to WhatsApp"
                                    >
                                      <MessageCircle size={14} />
                                    </button>
                                  )}
                                </div>
                                <span className={`text-[8px] font-condensed font-bold uppercase tracking-widest px-2 py-1 rounded ${
                                  f.status === 'played' ? 'bg-green-500/10 text-green-400' : 
                                  f.status === 'overdue' ? 'bg-yellow-500/10 text-yellow-400' : 
                                  'bg-white/5 text-white/30'
                                }`}>
                                  {f.status === 'played' ? 'Full Time' : f.status === 'overdue' ? 'Overdue' : 'Pending'}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
          </motion.div>
        )}

          {activeTab === 'players' && (
            <motion.div
              key="players"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-display text-2xl uppercase tracking-wider">
                  Squad <span className="text-pl-pink">Roster</span>
                </h2>
              </div>

              <div className="grid md:grid-cols-3 gap-6">
                {isAdmin && (
                  <div className="md:col-span-1">
                    <div className="glass rounded-xl p-6 sticky top-24">
                      <h3 className="font-condensed font-bold text-xs uppercase tracking-widest text-pl-cyan mb-6">Add New Player</h3>
                      <form onSubmit={addPlayer} className="space-y-4 mb-8 pb-8 border-b border-white/5">
                        <div>
                          <label className="block text-[10px] font-condensed text-white/40 uppercase tracking-widest mb-2">PSN / Name</label>
                          <input name="name" required className="w-full bg-pl-ink border border-white/10 rounded px-4 py-3 text-sm focus:border-pl-cyan outline-none transition-colors" placeholder="e.g. PlayerOne" />
                        </div>
                        <div>
                          <label className="block text-[10px] font-condensed text-white/40 uppercase tracking-widest mb-2">Club Choice</label>
                          <input name="club" className="w-full bg-pl-ink border border-white/10 rounded px-4 py-3 text-sm focus:border-pl-cyan outline-none transition-colors" placeholder="e.g. Man City" />
                        </div>
                        <div>
                          <label className="block text-[10px] font-condensed text-white/40 uppercase tracking-widest mb-2">Biography (Optional)</label>
                          <textarea name="bio" className="w-full bg-pl-ink border border-white/10 rounded px-4 py-3 text-sm focus:border-pl-cyan outline-none transition-colors h-20 resize-none" placeholder="Brief player bio..." />
                        </div>
                        <button className="w-full bg-pl-pink text-white py-3 rounded font-condensed font-bold text-xs uppercase tracking-widest hover:brightness-110 transition-all flex items-center justify-center gap-2">
                          <Plus size={14} /> Add to Squad
                        </button>
                      </form>

                      <h3 className="font-condensed font-bold text-xs uppercase tracking-widest text-pl-cyan mb-4">Bulk Import</h3>
                      <div className="space-y-4">
                        <textarea 
                          value={bulkText}
                          onChange={(e) => setBulkText(e.target.value)}
                          placeholder="Paste names here (one per line)..."
                          className="w-full h-32 bg-pl-ink border border-white/10 rounded px-4 py-3 text-sm focus:border-pl-cyan outline-none transition-colors resize-none"
                        />
                        <button 
                          onClick={addBulkPlayers}
                          className="w-full border border-pl-cyan text-pl-cyan py-3 rounded font-condensed font-bold text-xs uppercase tracking-widest hover:bg-pl-cyan hover:text-pl-ink transition-all flex items-center justify-center gap-2"
                        >
                          <Users size={14} /> Import List
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                <div className={`${isAdmin ? 'md:col-span-2' : 'md:col-span-3'} space-y-4`}>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-condensed font-bold text-xs uppercase tracking-widest text-white/40">Current Squad ({uniquePlayers.filter(p => p.active !== false).length} active / {uniquePlayers.length} total)</h3>
                    {isAdmin && players.length > 0 && (
                      <button 
                        onClick={clearAllPlayers}
                        className="text-[10px] font-condensed font-bold uppercase tracking-widest text-red-400 hover:text-red-300 transition-colors flex items-center gap-1"
                      >
                        <Trash2 size={12} /> Clear All
                      </button>
                    )}
                  </div>
                  <div className="grid sm:grid-cols-2 gap-4">
                    {uniquePlayers.sort((a, b) => a.name.localeCompare(b.name)).map((p, i) => (
                      <div 
                        key={p.id} 
                        onClick={() => {
                          setSelectedPlayer(p);
                          setPlayerBio(p.bio || '');
                          setShowPlayerModal(true);
                        }}
                        className={`glass rounded-xl p-4 flex items-center justify-between group cursor-pointer hover:bg-white/5 transition-all ${p.active === false ? 'opacity-40 border border-white/5' : ''}`}
                      >
                        <div className="flex items-center gap-4">
                          <div className={`w-12 h-12 rounded flex items-center justify-center font-display text-2xl ${p.active === false ? 'bg-white/5 text-white/20' : 'bg-pl-purple text-pl-cyan'}`}>
                            {i + 1}
                          </div>
                          <div>
                            <div className="font-bold">{p.name}</div>
                            {p.active === false && <div className="text-[10px] font-condensed text-red-400/70 uppercase tracking-widest">Inactive</div>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {isAdmin && (
                            <>
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  try {
                                    // Toggle active for all IDs with this name (handles duplicates)
                                    const ids = playerIdsByName[p.name] || [p.id];
                                    const newActive = p.active === false;
                                    for (const pid of ids) {
                                      await updateDoc(doc(db, 'players', pid), { active: newActive });
                                    }
                                    showToast(`${p.name} ${newActive ? 'activated' : 'deactivated'} for next season`);
                                  } catch (err) {
                                    showToast('Failed to toggle player status', 'error');
                                  }
                                }}
                                className={`p-2 transition-colors md:opacity-0 md:group-hover:opacity-100 ${p.active === false ? 'text-red-400/60 hover:text-green-400' : 'text-green-400/60 hover:text-red-400'}`}
                                title={p.active === false ? 'Activate for next season' : 'Deactivate for next season'}
                              >
                                {p.active === false ? <EyeOff size={16} /> : <Eye size={16} />}
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setAuctionPlayer(p);
                                  setBidAmount(p.value || 10);
                                  setShowAuctionModal(true);
                                }}
                                className="p-2 text-white/20 hover:text-pl-cyan transition-colors md:opacity-0 md:group-hover:opacity-100"
                                title="Auction Player"
                              >
                                <Swords size={16} />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deletePlayer(p.id);
                                }}
                                className="p-2 text-white/20 hover:text-red-500 transition-colors md:opacity-0 md:group-hover:opacity-100"
                              >
                                <Trash2 size={16} />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  {players.length === 0 && (
                    <div className="text-center py-20 border-2 border-dashed border-white/5 rounded-xl">
                      <Users className="mx-auto text-white/5 mb-4" size={48} />
                      <p className="text-white/20 font-condensed uppercase tracking-widest">No players in squad</p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'h2h' && (
            <motion.div
              key="h2h"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-display text-2xl uppercase tracking-wider">
                  Head to <span className="text-pl-pink">Head</span>
                </h2>
              </div>

              {/* Mode Toggle */}
              <div className="flex items-center gap-1 bg-white/5 p-1 rounded-lg border border-white/5 max-w-xs">
                <button
                  onClick={() => setH2hMode('versus')}
                  className={`flex-1 px-4 py-2 rounded-md text-[10px] font-bold uppercase tracking-widest transition-all ${
                    h2hMode === 'versus' ? 'bg-pl-cyan text-pl-ink shadow-lg' : 'text-white/40 hover:text-white/60'
                  }`}
                >
                  1 vs 1
                </button>
                <button
                  onClick={() => setH2hMode('all')}
                  className={`flex-1 px-4 py-2 rounded-md text-[10px] font-bold uppercase tracking-widest transition-all ${
                    h2hMode === 'all' ? 'bg-pl-cyan text-pl-ink shadow-lg' : 'text-white/40 hover:text-white/60'
                  }`}
                >
                  All Matches
                </button>
              </div>

              {h2hMode === 'versus' ? (
                <>
              <div className="glass rounded-xl p-6">
                <div className="grid md:grid-cols-2 gap-8 items-center">
                  <div className="space-y-4">
                    <label className="block text-[10px] font-condensed text-white/40 uppercase tracking-widest">Select Players</label>
                    <div className="flex items-center gap-4">
                      <select
                        value={h2hPlayers.p1}
                        onChange={(e) => setH2hPlayers({ ...h2hPlayers, p1: e.target.value })}
                        className="flex-1 bg-pl-ink border border-white/10 rounded px-4 py-3 text-sm focus:border-pl-cyan outline-none transition-colors"
                      >
                        <option value="">Player 1</option>
                        {[...allPlayers].filter((p, i, arr) => arr.findIndex(x => x.name === p.name) === i).sort((a, b) => a.name.localeCompare(b.name)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                      <div className="font-display text-xl text-white/20">VS</div>
                      <select
                        value={h2hPlayers.p2}
                        onChange={(e) => setH2hPlayers({ ...h2hPlayers, p2: e.target.value })}
                        className="flex-1 bg-pl-ink border border-white/10 rounded px-4 py-3 text-sm focus:border-pl-cyan outline-none transition-colors"
                      >
                        <option value="">Player 2</option>
                        {[...allPlayers].filter((p, i, arr) => arr.findIndex(x => x.name === p.name) === i).sort((a, b) => a.name.localeCompare(b.name)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                  </div>

                  {h2hData ? (
                    <div className="flex items-center justify-around bg-pl-ink/50 p-6 rounded-lg border border-white/5">
                      <div className="text-center">
                        <div className="font-display text-4xl text-pl-cyan">{h2hData.p1w}</div>
                        <div className="text-[10px] font-condensed text-white/40 uppercase tracking-widest mt-1">Wins</div>
                        <div className="text-[10px] font-condensed text-pl-cyan/60 uppercase tracking-widest mt-1">{h2hData.p1g} Goals</div>
                      </div>
                      <div className="text-center">
                        <div className="font-display text-4xl text-white/40">{h2hData.draws}</div>
                        <div className="text-[10px] font-condensed text-white/40 uppercase tracking-widest mt-1">Draws</div>
                      </div>
                      <div className="text-center">
                        <div className="font-display text-4xl text-pl-pink">{h2hData.p2w}</div>
                        <div className="text-[10px] font-condensed text-white/40 uppercase tracking-widest mt-1">Wins</div>
                        <div className="text-[10px] font-condensed text-pl-pink/60 uppercase tracking-widest mt-1">{h2hData.p2g} Goals</div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center text-white/20 font-condensed uppercase tracking-widest text-sm">
                      Select two players to see history
                    </div>
                  )}
                </div>
              </div>

              {h2hData && (
                <div className="space-y-4">
                  <h3 className="font-condensed font-bold text-xs uppercase tracking-widest text-white/40">Match History</h3>
                  <div className="grid gap-3">
                    {h2hData.matches.map(f => {
                      const isP1Home = h2hData.p1Ids.has(f.homeId);
                      const p1Goals = isP1Home ? f.homeScore : f.awayScore;
                      const p2Goals = isP1Home ? f.awayScore : f.homeScore;
                      
                      let result = '';
                      let resultColor = 'bg-white/5 text-white/20';
                      
                      if (f.status === 'played') {
                        if (p1Goals! > p2Goals!) {
                          result = 'W';
                          resultColor = 'bg-green-500/20 text-green-400 border border-green-500/30';
                        } else if (p1Goals! < p2Goals!) {
                          result = 'L';
                          resultColor = 'bg-red-500/20 text-red-400 border border-red-500/30';
                        } else {
                          result = 'D';
                          resultColor = 'bg-white/10 text-white/60 border border-white/20';
                        }
                      }

                      return (
                        <div key={f.id} className="glass rounded-lg p-4 flex flex-col gap-3 group hover:bg-white/5 transition-colors">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3 flex-1">
                              {result && (
                                <div className={`w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold ${resultColor}`}>
                                  {result}
                                </div>
                              )}
                              <div className={`font-bold ${isP1Home ? 'text-pl-cyan' : ''}`}>{f.homeName}</div>
                            </div>

                            <div className="flex items-center gap-4 px-6 bg-pl-ink/30 py-1 rounded-full">
                              <div className="font-display text-xl w-6 text-center">{f.status === 'played' ? f.homeScore : '-'}</div>
                              <div className="text-white/10 font-condensed text-[8px] uppercase tracking-widest">VS</div>
                              <div className="font-display text-xl w-6 text-center">{f.status === 'played' ? f.awayScore : '-'}</div>
                            </div>

                            <div className={`flex-1 text-right font-bold ${!isP1Home ? 'text-pl-cyan' : ''}`}>{f.awayName}</div>
                          </div>

                          {isAdmin && h2hEditingFixture === f.id ? (
                            <div className="flex items-center justify-center gap-3 bg-pl-ink/50 p-3 rounded-lg border border-white/10">
                              <span className="text-[10px] font-condensed text-white/40 uppercase tracking-widest">{f.homeName}</span>
                              <input
                                type="number"
                                min="0"
                                value={h2hScores.home}
                                onChange={(e) => setH2hScores({ ...h2hScores, home: parseInt(e.target.value) || 0 })}
                                className="w-14 bg-pl-ink border border-white/20 rounded-lg px-2 py-2 text-center font-display text-lg focus:border-pl-cyan outline-none"
                              />
                              <span className="text-white/20 font-condensed text-xs">-</span>
                              <input
                                type="number"
                                min="0"
                                value={h2hScores.away}
                                onChange={(e) => setH2hScores({ ...h2hScores, away: parseInt(e.target.value) || 0 })}
                                className="w-14 bg-pl-ink border border-white/20 rounded-lg px-2 py-2 text-center font-display text-lg focus:border-pl-cyan outline-none"
                              />
                              <span className="text-[10px] font-condensed text-white/40 uppercase tracking-widest">{f.awayName}</span>
                              <button
                                onClick={() => submitH2hScore(f.id)}
                                className="bg-pl-cyan text-pl-ink px-4 py-2 rounded-lg font-condensed font-bold text-[10px] uppercase tracking-widest hover:brightness-110 transition-all"
                              >
                                Save
                              </button>
                              <button
                                onClick={() => setH2hEditingFixture(null)}
                                className="bg-white/10 text-white/60 px-4 py-2 rounded-lg font-condensed font-bold text-[10px] uppercase tracking-widest hover:bg-white/20 transition-all"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : isAdmin ? (
                            <button
                              onClick={() => {
                                setH2hEditingFixture(f.id);
                                setH2hScores({ home: f.homeScore ?? 0, away: f.awayScore ?? 0 });
                              }}
                              className="text-[10px] font-condensed text-pl-cyan/50 uppercase tracking-widest hover:text-pl-cyan transition-colors text-center"
                            >
                              {f.status === 'played' ? 'Edit Score' : 'Enter Score'}
                            </button>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
                </>
              ) : (
                /* All Matches Mode */
                <>
                  <div className="glass rounded-xl p-6">
                    <div className="space-y-4">
                      <label className="block text-[10px] font-condensed text-white/40 uppercase tracking-widest">Select Player</label>
                      <select
                        value={h2hSoloPlayer}
                        onChange={(e) => setH2hSoloPlayer(e.target.value)}
                        className="w-full bg-pl-ink border border-white/10 rounded px-4 py-3 text-sm focus:border-pl-cyan outline-none transition-colors"
                      >
                        <option value="">Choose a player...</option>
                        {[...allPlayers].filter((p, i, arr) => arr.findIndex(x => x.name === p.name) === i).sort((a, b) => a.name.localeCompare(b.name)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>

                    {soloPlayerData && (
                      <div className="flex items-center justify-around bg-pl-ink/50 p-6 rounded-lg border border-white/5 mt-6">
                        <div className="text-center">
                          <div className="font-display text-3xl text-pl-cyan">{soloPlayerData.played}</div>
                          <div className="text-[10px] font-condensed text-white/40 uppercase tracking-widest mt-1">Played</div>
                        </div>
                        <div className="text-center">
                          <div className="font-display text-3xl text-green-400">{soloPlayerData.wins}</div>
                          <div className="text-[10px] font-condensed text-white/40 uppercase tracking-widest mt-1">Wins</div>
                        </div>
                        <div className="text-center">
                          <div className="font-display text-3xl text-white/40">{soloPlayerData.draws}</div>
                          <div className="text-[10px] font-condensed text-white/40 uppercase tracking-widest mt-1">Draws</div>
                        </div>
                        <div className="text-center">
                          <div className="font-display text-3xl text-red-400">{soloPlayerData.losses}</div>
                          <div className="text-[10px] font-condensed text-white/40 uppercase tracking-widest mt-1">Losses</div>
                        </div>
                        <div className="text-center">
                          <div className="font-display text-3xl text-pl-cyan">{soloPlayerData.gf}-{soloPlayerData.ga}</div>
                          <div className="text-[10px] font-condensed text-white/40 uppercase tracking-widest mt-1">GF-GA</div>
                        </div>
                      </div>
                    )}
                  </div>

                  {soloPlayerData && soloPlayerData.matches.length > 0 && (() => {
                    // Group matches by opponent name (handles duplicate player IDs)
                    const { pIds } = soloPlayerData;
                    const grouped: Record<string, { oppName: string; matches: typeof soloPlayerData.matches }> = {};
                    soloPlayerData.matches.forEach(f => {
                      const isHome = pIds.has(f.homeId);
                      const oppName = isHome ? f.awayName : f.homeName;
                      if (!grouped[oppName]) grouped[oppName] = { oppName, matches: [] };
                      grouped[oppName].matches.push(f);
                    });
                    // Sort groups: most recent match first
                    const sortedGroups = Object.entries(grouped).sort((a, b) => b[1].matches[0].matchday - a[1].matches[0].matchday);
                    const playerName = allPlayers.find(p => p.id === h2hSoloPlayer)?.name || '';

                    return (
                      <div className="space-y-6">
                        <h3 className="font-condensed font-bold text-xs uppercase tracking-widest text-white/40">
                          Matches by Opponent ({soloPlayerData.matches.length} total)
                        </h3>
                        {sortedGroups.map(([oppId, group]) => {
                          const homeLeg = group.matches.find(f => pIds.has(f.homeId));
                          const awayLeg = group.matches.find(f => pIds.has(f.awayId));

                          return (
                            <div key={oppId} className="glass rounded-xl overflow-hidden border border-white/10">
                              <div className="bg-white/5 px-4 py-3 border-b border-white/10">
                                <h4 className="font-condensed font-bold text-sm uppercase tracking-wider">
                                  <span className="text-pl-cyan">{playerName}</span>
                                  <span className="text-white/30 mx-2">vs</span>
                                  <span className="text-pl-pink">{group.oppName}</span>
                                </h4>
                              </div>
                              <div className="divide-y divide-white/5">
                                {/* Header row */}
                                <div className="grid grid-cols-3 px-4 py-2 text-[9px] font-condensed text-white/30 uppercase tracking-widest">
                                  <div>Home</div>
                                  <div className="text-center">Score</div>
                                  <div className="text-right">Away</div>
                                </div>
                                {/* Home leg: selected player at home */}
                                {homeLeg && (() => {
                                  const myG = homeLeg.homeScore!;
                                  const oppG = homeLeg.awayScore!;
                                  const res = myG > oppG ? 'W' : myG < oppG ? 'L' : 'D';
                                  const resColor = res === 'W' ? 'text-green-400' : res === 'L' ? 'text-red-400' : 'text-white/60';
                                  return (
                                    <div className="grid grid-cols-3 items-center px-4 py-3 hover:bg-white/5 transition-colors">
                                      <div className="font-bold text-sm text-pl-cyan">{playerName}</div>
                                      <div className="flex items-center justify-center gap-3">
                                        <span className={`font-display text-xl ${resColor}`}>{homeLeg.homeScore}</span>
                                        <span className="text-white/20 text-[8px] font-condensed uppercase">vs</span>
                                        <span className="font-display text-xl text-white/50">{homeLeg.awayScore}</span>
                                      </div>
                                      <div className="text-right font-bold text-sm text-white/60">{group.oppName}</div>
                                    </div>
                                  );
                                })()}
                                {/* Away leg: selected player away */}
                                {awayLeg && (() => {
                                  const myG = awayLeg.awayScore!;
                                  const oppG = awayLeg.homeScore!;
                                  const res = myG > oppG ? 'W' : myG < oppG ? 'L' : 'D';
                                  const resColor = res === 'W' ? 'text-green-400' : res === 'L' ? 'text-red-400' : 'text-white/60';
                                  return (
                                    <div className="grid grid-cols-3 items-center px-4 py-3 hover:bg-white/5 transition-colors">
                                      <div className="font-bold text-sm text-white/60">{group.oppName}</div>
                                      <div className="flex items-center justify-center gap-3">
                                        <span className="font-display text-xl text-white/50">{awayLeg.homeScore}</span>
                                        <span className="text-white/20 text-[8px] font-condensed uppercase">vs</span>
                                        <span className={`font-display text-xl ${resColor}`}>{awayLeg.awayScore}</span>
                                      </div>
                                      <div className="text-right font-bold text-sm text-pl-cyan">{playerName}</div>
                                    </div>
                                  );
                                })()}
                                {!homeLeg && !awayLeg && (
                                  <div className="px-4 py-3 text-white/20 text-xs font-condensed uppercase tracking-widest text-center">
                                    No matches played yet
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}

                  {soloPlayerData && soloPlayerData.matches.length === 0 && (
                    <div className="text-center text-white/20 font-condensed uppercase tracking-widest text-sm py-8">
                      No played matches found for this player
                    </div>
                  )}
                </>
              )}
            </motion.div>
          )}
          {activeTab === 'market' && (
            <motion.div
              key="market"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-display text-2xl uppercase tracking-wider flex items-center gap-3">
                  Transfer <span className="text-pl-cyan">Market</span>
                </h2>
                <div className="text-[10px] font-condensed font-bold text-white/40 uppercase tracking-widest">
                  Live Auctions
                </div>
              </div>

              <div className="grid md:grid-cols-3 gap-6">
                <div className="md:col-span-2 space-y-6">
                  <div className="grid sm:grid-cols-2 gap-4">
                    {auctions.filter(a => a.status === 'active').map((auction) => (
                      <div key={auction.id} className="glass rounded-2xl p-6 border-l-4 border-pl-cyan relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                          <Swords size={64} />
                        </div>
                        
                        <div className="relative z-10">
                          <div className="flex justify-between items-start mb-4">
                            <div>
                              <h3 className="font-display text-xl uppercase tracking-wider">{auction.playerName}</h3>
                              <p className="text-[10px] font-condensed text-white/40 uppercase tracking-widest">Seller: {allUsers.find(u => u.uid === auction.sellerUid)?.displayName || 'Unknown'}</p>
                            </div>
                            <div className="bg-pl-cyan/10 text-pl-cyan px-2 py-1 rounded text-[10px] font-bold uppercase tracking-widest">
                              Active
                            </div>
                          </div>

                          <div className="bg-pl-ink/50 rounded-xl p-4 mb-6 border border-white/5">
                            <div className="flex justify-between items-center mb-2">
                              <span className="text-[10px] font-condensed text-white/40 uppercase tracking-widest">Current Bid</span>
                              <span className="text-xl font-display text-pl-cyan">£{auction.currentBid}M</span>
                            </div>
                            <div className="text-[10px] font-condensed text-white/60 uppercase tracking-widest truncate">
                              Highest Bidder: {auction.highestBidderName || 'None'}
                            </div>
                          </div>

                          {isAdmin && (
                            <div className="space-y-3">
                              <div className="flex gap-2">
                                <input 
                                  type="number" 
                                  placeholder="Bid amount..."
                                  className="flex-1 bg-pl-ink border border-white/10 rounded px-3 py-2 text-xs focus:border-pl-cyan outline-none transition-colors"
                                  onChange={(e) => setBidAmount(parseInt(e.target.value) || 0)}
                                />
                                <button 
                                  onClick={() => placeBid(auction, bidAmount)}
                                  className="bg-pl-cyan text-pl-ink px-4 py-2 rounded font-condensed font-bold text-[10px] uppercase tracking-widest hover:brightness-110 transition-all"
                                >
                                  Bid
                                </button>
                              </div>
                              <button 
                                onClick={() => completeAuction(auction)}
                                className="w-full border border-white/10 text-white/40 py-2 rounded font-condensed font-bold text-[10px] uppercase tracking-widest hover:bg-white/5 transition-all"
                              >
                                Admin: Complete
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    {auctions.filter(a => a.status === 'active').length === 0 && (
                      <div className="sm:col-span-2 glass rounded-2xl p-12 text-center border-dashed border-2 border-white/5">
                        <MessageSquare className="mx-auto text-white/10 mb-4" size={48} />
                        <p className="text-white/40 font-condensed uppercase tracking-widest text-sm">No active auctions at the moment</p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="glass rounded-2xl p-6 border-t-4 border-pl-pink">
                    <h3 className="font-display text-lg uppercase tracking-wider mb-4">Market <span className="text-pl-pink">Rules</span></h3>
                    <ul className="space-y-4 text-xs text-white/60 leading-relaxed">
                      <li className="flex gap-3">
                        <div className="w-4 h-4 rounded-full bg-pl-pink/20 flex-shrink-0 flex items-center justify-center text-[8px] font-bold text-pl-pink">1</div>
                        Auctions last 24 hours from start.
                      </li>
                      <li className="flex gap-3">
                        <div className="w-4 h-4 rounded-full bg-pl-pink/20 flex-shrink-0 flex items-center justify-center text-[8px] font-bold text-pl-pink">2</div>
                        Highest bidder at expiry wins the player.
                      </li>
                      <li className="flex gap-3">
                        <div className="w-4 h-4 rounded-full bg-pl-pink/20 flex-shrink-0 flex items-center justify-center text-[8px] font-bold text-pl-pink">3</div>
                        Salary Cap: Total squad value cannot exceed £200M.
                      </li>
                    </ul>
                  </div>

                  <div className="glass rounded-2xl p-6">
                    <h3 className="font-display text-lg uppercase tracking-wider mb-4">Recent <span className="text-pl-cyan">Transfers</span></h3>
                    <div className="space-y-3">
                      {auctions.filter(a => a.status === 'completed').slice(0, 5).map(a => (
                        <div key={a.id} className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/5">
                          <div>
                            <div className="font-bold text-xs">{a.playerName}</div>
                            <div className="text-[8px] text-white/40 uppercase tracking-widest">To: {a.highestBidderName}</div>
                          </div>
                          <div className="text-pl-cyan font-display text-sm">£{a.currentBid}M</div>
                        </div>
                      ))}
                      {auctions.filter(a => a.status === 'completed').length === 0 && (
                        <p className="text-[10px] text-white/20 uppercase tracking-widest text-center py-4">No recent transfers</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
          {activeTab === 'news' && (
            <motion.div
              key="news"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-display text-4xl uppercase tracking-wider mb-1">League <span className="text-pl-pink">News</span></h2>
                  <p className="text-white/40 font-condensed uppercase tracking-widest text-xs">Latest updates from SHATTA MOVEMENT LEAGUE</p>
                </div>
                {isAdmin && (
                  <button 
                    onClick={() => {
                      setEditingNews(null);
                      setNewNews({ title: '', content: '', imageUrl: '' });
                      setShowNewsModal(true);
                    }}
                    className="bg-pl-cyan text-pl-ink px-6 py-3 rounded-xl font-condensed font-bold text-xs uppercase tracking-widest hover:scale-105 transition-transform flex items-center gap-2"
                  >
                    <Newspaper size={16} /> Create Article
                  </button>
                )}
              </div>

              <div className="grid md:grid-cols-2 gap-8">
                {news.map((article) => (
                  <motion.article 
                    key={article.id}
                    layout
                    className="glass rounded-2xl overflow-hidden flex flex-col group"
                  >
                    {article.imageUrl && (
                      <div className="aspect-video relative overflow-hidden">
                        <img 
                          src={article.imageUrl || undefined} 
                          alt={article.title} 
                          className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                          referrerPolicy="no-referrer"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-pl-ink to-transparent opacity-60"></div>
                      </div>
                    )}
                    <div className="p-8 flex-1 flex flex-col">
                      <div className="flex justify-between items-start mb-4">
                        <span className="text-[10px] font-bold text-pl-pink uppercase tracking-widest bg-pl-pink/10 px-2 py-1 rounded">
                          {article.createdAt?.toDate().toLocaleDateString() || 'Just now'}
                        </span>
                        {isAdmin && (
                          <div className="flex gap-2">
                            <button 
                              onClick={() => {
                                setEditingNews(article);
                                setNewNews({ title: article.title, content: article.content, imageUrl: article.imageUrl || '' });
                                setShowNewsModal(true);
                              }}
                              className="text-white/20 hover:text-pl-cyan transition-colors"
                            >
                              <Edit3 size={14} />
                            </button>
                            <button 
                              onClick={() => deleteNews(article.id)}
                              className="text-white/20 hover:text-red-500 transition-colors"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        )}
                      </div>
                      <h3 className="font-display text-2xl uppercase tracking-wider mb-4 group-hover:text-pl-cyan transition-colors leading-tight">
                        {article.title}
                      </h3>
                      <p className="text-white/60 text-sm leading-relaxed mb-8 flex-1 line-clamp-4">
                        {article.content}
                      </p>
                      <div className="flex items-center gap-3 pt-6 border-t border-white/5">
                        <div className="w-8 h-8 rounded-full bg-pl-purple flex items-center justify-center text-[10px] font-bold text-pl-cyan">
                          {article.authorName?.charAt(0)}
                        </div>
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">Posted by</p>
                          <p className="text-xs font-bold text-pl-cyan">{article.authorName}</p>
                        </div>
                      </div>
                    </div>
                  </motion.article>
                ))}
                {news.length === 0 && (
                  <div className="md:col-span-2 py-20 text-center glass rounded-2xl border-dashed border-2 border-white/5">
                    <Newspaper className="mx-auto text-white/10 mb-4" size={48} />
                    <p className="text-white/40 font-condensed uppercase tracking-widest text-sm">No news articles yet</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}
          {activeTab === 'rules' && (
            <motion.div
              key="rules"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="max-w-2xl mx-auto space-y-8"
            >
              <div className="text-center">
                <h2 className="font-display text-4xl uppercase tracking-wider mb-2">Rule <span className="text-pl-pink">Book</span></h2>
                <p className="text-white/40 font-condensed uppercase tracking-widest text-xs">Season 2025/26 Regulations</p>
              </div>

              <div className="space-y-4">
                {[
                  { title: "Tournament Format", desc: "Double Round Robin. Every player plays everyone else twice (Home & Away)." },
                  { title: "Points System", desc: "3 points for a win, 1 for a draw, 0 for a loss." },
                  { title: "Match Settings", desc: "6 minute halves, Tactical Defending, Normal Game Speed." },
                  { title: "Deadlines", desc: "All fixtures must be played within 7 days of the matchday start. Failure to play results in a 3-0 forfeit." },
                  { title: "UEFA Qualification", desc: "Top 6 at the end of the league qualify directly for the UEFA bracket. 7th plays 9th and 8th plays 10th in a 2-leg playoff (best aggregate). The two playoff winners join the top 6 in the UEFA bracket." },
                  { title: "Fair Play", desc: "Good vibes only. Rage quitting results in an automatic 3-0 loss and potential league ban." },
                ].map((rule, i) => (
                  <div key={i} className="glass rounded-xl p-6 flex gap-6">
                    <div className="font-display text-4xl text-pl-pink/20 leading-none">{i + 1}</div>
                    <div>
                      <h4 className="font-condensed font-bold text-sm uppercase tracking-widest text-pl-cyan mb-2">{rule.title}</h4>
                      <p className="text-white/60 text-sm leading-relaxed">{rule.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
          {activeTab === 'playoff' && (
            <motion.div
              key="playoff"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8"
            >
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <h2 className="font-display text-3xl uppercase tracking-wider mb-1">
                    Play<span className="text-emerald-400">offs</span>
                  </h2>
                  <p className="text-white/40 font-condensed uppercase tracking-widest text-xs">
                    Top 8 Knockout — QF • SF • Final — 2 legs each
                  </p>
                </div>
                {isAdmin && (
                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={generatePlayoffs}
                      className="bg-emerald-600 text-white px-4 py-2.5 rounded-xl font-condensed font-bold text-[10px] uppercase tracking-widest hover:scale-105 transition-transform flex items-center gap-2"
                    >
                      <Swords size={12} /> Generate QF
                    </button>
                    <button
                      onClick={generateSemiFinals}
                      className="bg-amber-600 text-white px-4 py-2.5 rounded-xl font-condensed font-bold text-[10px] uppercase tracking-widest hover:scale-105 transition-transform flex items-center gap-2"
                    >
                      <Swords size={12} /> Generate SF
                    </button>
                    <button
                      onClick={generateFinal}
                      className="bg-yellow-500 text-black px-4 py-2.5 rounded-xl font-condensed font-bold text-[10px] uppercase tracking-widest hover:scale-105 transition-transform flex items-center gap-2"
                    >
                      <Trophy size={12} /> Generate Final
                    </button>
                  </div>
                )}
              </div>

              {/* Top 8 Qualification summary */}
              {(() => {
                const activeTable = tableData.filter(p => p.p > 0);
                return activeTable.length >= 8 ? (
                <div className="glass rounded-2xl p-6 border-l-4 border-emerald-400">
                  <h3 className="font-condensed font-bold text-xs uppercase tracking-widest text-emerald-400 mb-4">
                    Qualified for Playoffs — Top 8
                  </h3>
                  <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-3">
                    {activeTable.slice(0, 8).map((p, i) => (
                      <div key={p.id} className="flex items-center gap-3 bg-emerald-400/10 border border-emerald-400/20 rounded-xl px-4 py-3">
                        <span className="font-display text-2xl text-emerald-400 w-7">{i + 1}</span>
                        <div className="min-w-0">
                          <div className="font-bold text-sm truncate">{p.name}</div>
                          <div className="text-[10px] text-white/40 uppercase tracking-widest">{p.pts} pts</div>
                        </div>
                        <CheckCircle2 className="ml-auto text-emerald-400 flex-shrink-0" size={16} />
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center py-12 glass rounded-xl">
                  <Swords className="mx-auto text-white/10 mb-4" size={48} />
                  <p className="text-white/40 font-condensed tracking-widest uppercase text-xs">
                    Need at least 8 players with games played in the league table
                  </p>
                </div>
              )})()}

              {/* Render a playoff round section */}
              {(() => {
                const renderRound = (round: 'QF' | 'SF' | 'F', label: string, color: string, borderColor: string) => {
                  const ties = getPlayoffTies(round);
                  if (ties.length === 0) return null;

                  const seedLabels: Record<string, string> = {};
                  const activeTable = tableData.filter(p => p.p > 0);
                  if (round === 'QF' && activeTable.length >= 8) {
                    // Map QF matchups to seed labels
                    const qfSeeds = [
                      { h: activeTable[0], a: activeTable[7], label: '1st vs 8th' },
                      { h: activeTable[3], a: activeTable[4], label: '4th vs 5th' },
                      { h: activeTable[1], a: activeTable[6], label: '2nd vs 7th' },
                      { h: activeTable[2], a: activeTable[5], label: '3rd vs 6th' },
                    ];
                    qfSeeds.forEach(s => {
                      const key = [s.h.id, s.a.id].sort().join('-');
                      seedLabels[key] = s.label;
                    });
                  }

                  return (
                    <div className="space-y-6">
                      <div className="flex items-center gap-4">
                        <div className={`h-px flex-grow ${borderColor}`} />
                        <h3 className={`font-display text-xl uppercase tracking-[0.3em] ${color}`}>
                          {round === 'F' && <Trophy size={18} className="inline mr-2 -mt-1" />}
                          {label}
                        </h3>
                        <div className={`h-px flex-grow ${borderColor}`} />
                      </div>

                      <div className={`grid ${round === 'F' ? 'grid-cols-1 max-w-2xl mx-auto' : round === 'SF' ? 'md:grid-cols-2' : 'md:grid-cols-2'} gap-6`}>
                        {ties.map((legs, tieIdx) => {
                          const p1Id = legs[0].homeId;
                          const p2Id = legs[0].awayId;
                          const p1Name = legs[0].homeName;
                          const p2Name = legs[0].awayName;
                          const tieKey = [p1Id, p2Id].sort().join('-');

                          let p1Agg = 0, p2Agg = 0;
                          legs.forEach(f => {
                            if (f.status === 'played') {
                              if (f.homeId === p1Id) { p1Agg += f.homeScore || 0; p2Agg += f.awayScore || 0; }
                              else { p2Agg += f.homeScore || 0; p1Agg += f.awayScore || 0; }
                            }
                          });
                          const bothPlayed = legs.length === 2 && legs.every(l => l.status === 'played');
                          const winnerId = bothPlayed ? getPlayoffWinner(p1Id, p2Id, round) : null;
                          const winnerName = winnerId === p1Id ? p1Name : winnerId === p2Id ? p2Name : null;

                          return (
                            <div key={tieIdx} className={`glass rounded-2xl p-5 space-y-4 ${round === 'F' ? 'border-2 border-yellow-400/30 shadow-[0_0_30px_rgba(250,204,21,0.1)]' : `border ${borderColor}`}`}>
                              {/* Tie header */}
                              <div className="text-center">
                                {seedLabels[tieKey] && (
                                  <div className="text-[10px] font-condensed text-white/30 uppercase tracking-widest mb-1">{seedLabels[tieKey]}</div>
                                )}
                                <div className="flex items-center justify-center gap-3">
                                  <span className="font-bold text-sm truncate max-w-[120px]">{p1Name}</span>
                                  <span className={`font-display text-2xl ${color}`}>
                                    {legs.some(l => l.status === 'played') ? `${p1Agg}–${p2Agg}` : 'vs'}
                                  </span>
                                  <span className="font-bold text-sm truncate max-w-[120px]">{p2Name}</span>
                                </div>
                                <div className="text-[10px] font-condensed text-white/30 uppercase tracking-widest mt-1">Aggregate</div>
                                {winnerName && (
                                  <div className={`mt-2 inline-block ${round === 'F' ? 'bg-yellow-400/20 text-yellow-400 border-yellow-400/30' : `bg-emerald-400/20 text-emerald-400 border-emerald-400/30`} text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full border`}>
                                    {round === 'F' ? `🏆 ${winnerName} wins!` : `${winnerName} advances`}
                                  </div>
                                )}
                              </div>

                              {/* Individual legs */}
                              {legs.map((f, li) => (
                                <div key={f.id} className={`bg-pl-ink/30 rounded-lg p-3 space-y-2 border-l-2 ${borderColor}`}>
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs font-bold truncate flex-1 text-right">{f.homeName}</span>
                                    <div className="flex items-center gap-2 bg-pl-ink/50 px-4 py-1.5 rounded-full border border-white/5">
                                      <span className="font-display text-lg w-6 text-center">{f.status === 'played' ? f.homeScore : '-'}</span>
                                      <span className="text-white/20 text-[8px] font-condensed uppercase">vs</span>
                                      <span className="font-display text-lg w-6 text-center">{f.status === 'played' ? f.awayScore : '-'}</span>
                                    </div>
                                    <span className="text-xs font-bold truncate flex-1">{f.awayName}</span>
                                    <span className={`text-[8px] font-condensed font-bold uppercase tracking-widest px-2 py-0.5 rounded ${
                                      f.status === 'played' ? 'bg-green-500/10 text-green-400' : 'bg-white/5 text-white/30'
                                    }`}>
                                      L{li + 1}
                                    </span>
                                  </div>

                                  {isAdmin && playoffEditingFixture === f.id ? (
                                    <div className="flex items-center justify-center gap-2 bg-pl-ink/50 p-2 rounded-lg border border-white/10 flex-wrap">
                                      <span className="text-[9px] font-condensed text-white/40 uppercase">{f.homeName}</span>
                                      <input type="number" min="0" value={playoffScores.home}
                                        onChange={(e) => setPlayoffScores({ ...playoffScores, home: parseInt(e.target.value) || 0 })}
                                        className="w-12 bg-pl-ink border border-white/20 rounded px-2 py-1.5 text-center font-display text-base focus:border-emerald-400 outline-none"
                                      />
                                      <span className="text-white/20 text-xs">-</span>
                                      <input type="number" min="0" value={playoffScores.away}
                                        onChange={(e) => setPlayoffScores({ ...playoffScores, away: parseInt(e.target.value) || 0 })}
                                        className="w-12 bg-pl-ink border border-white/20 rounded px-2 py-1.5 text-center font-display text-base focus:border-emerald-400 outline-none"
                                      />
                                      <span className="text-[9px] font-condensed text-white/40 uppercase">{f.awayName}</span>
                                      <button onClick={() => submitPlayoffScore(f.id)}
                                        className="bg-emerald-500 text-white px-3 py-1.5 rounded font-condensed font-bold text-[9px] uppercase tracking-widest hover:brightness-110">
                                        Save
                                      </button>
                                      <button onClick={() => setPlayoffEditingFixture(null)}
                                        className="bg-white/10 text-white/60 px-3 py-1.5 rounded font-condensed font-bold text-[9px] uppercase tracking-widest hover:bg-white/20">
                                        Cancel
                                      </button>
                                    </div>
                                  ) : isAdmin ? (
                                    <button
                                      onClick={() => { setPlayoffEditingFixture(f.id); setPlayoffScores({ home: f.homeScore ?? 0, away: f.awayScore ?? 0 }); }}
                                      className={`text-[10px] font-condensed ${color} opacity-60 uppercase tracking-widest hover:opacity-100 transition-colors text-center w-full`}
                                    >
                                      {f.status === 'played' ? 'Edit Score' : 'Enter Score'}
                                    </button>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                };

                return (
                  <div className="space-y-10">
                    {renderRound('QF', 'Quarter-Finals', 'text-emerald-400', 'border-emerald-400/30')}
                    {renderRound('SF', 'Semi-Finals', 'text-amber-400', 'border-amber-400/30')}
                    {renderRound('F', 'Final', 'text-yellow-400', 'border-yellow-400/30')}
                    {playoffFixtures.length === 0 && (
                      <div className="text-center py-16 glass rounded-xl">
                        <Swords className="mx-auto text-white/10 mb-4" size={48} />
                        <p className="text-white/40 font-condensed tracking-widest uppercase text-xs">
                          No playoff fixtures yet. Complete the league, then generate Quarter-Finals.
                        </p>
                      </div>
                    )}
                  </div>
                );
              })()}
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {toast && (
            <motion.div 
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 50 }}
              className={`fixed bottom-8 right-8 px-6 py-3 rounded-lg shadow-xl z-[200] font-condensed font-bold text-xs uppercase tracking-widest ${toast.type === 'success' ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'}`}
            >
              {toast.message}
            </motion.div>
          )}
        </AnimatePresence>
        {activeTab === 'halloffame' && (
          <motion.div
            key="halloffame"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-8 max-w-2xl mx-auto"
          >
            <div className="text-center">
              <h2 className="font-display text-4xl uppercase tracking-wider mb-2">Hall of <span className="text-yellow-400">Fame</span></h2>
              <p className="text-white/40 font-condensed uppercase tracking-widest text-xs">Tournament Champions</p>
            </div>

            {isAdmin && (
              <div className="glass p-6 rounded-2xl border-l-4 border-yellow-400">
                <h3 className="font-condensed font-bold text-xs uppercase tracking-widest text-yellow-400 mb-4">
                  {editingChampion !== null ? 'Edit Champion' : 'Add Champion'}
                </h3>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <input
                    type="text"
                    value={newChampion.season}
                    onChange={(e) => setNewChampion({ ...newChampion, season: e.target.value })}
                    placeholder="Season (e.g. Season 1)"
                    className="bg-pl-ink border border-white/10 rounded-xl px-4 py-3 text-xs focus:border-yellow-400 outline-none transition-colors"
                  />
                  <input
                    type="text"
                    value={newChampion.year || ''}
                    onChange={(e) => setNewChampion({ ...newChampion, year: e.target.value })}
                    placeholder="Year (e.g. 2026)"
                    className="bg-pl-ink border border-white/10 rounded-xl px-4 py-3 text-xs focus:border-yellow-400 outline-none transition-colors"
                  />
                  <input
                    type="text"
                    value={newChampion.winner}
                    onChange={(e) => setNewChampion({ ...newChampion, winner: e.target.value })}
                    placeholder="Winner name"
                    className="bg-pl-ink border border-white/10 rounded-xl px-4 py-3 text-xs focus:border-yellow-400 outline-none transition-colors"
                  />
                  <input
                    type="text"
                    value={newChampion.runnerUp || ''}
                    onChange={(e) => setNewChampion({ ...newChampion, runnerUp: e.target.value })}
                    placeholder="Runner-up (optional)"
                    className="bg-pl-ink border border-white/10 rounded-xl px-4 py-3 text-xs focus:border-yellow-400 outline-none transition-colors"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={saveChampion}
                    className="bg-yellow-400 text-pl-ink px-5 py-2 rounded-xl font-condensed font-bold text-[10px] uppercase tracking-widest hover:brightness-110 transition-all"
                  >
                    {editingChampion !== null ? 'Update' : 'Add Champion'}
                  </button>
                  {editingChampion !== null && (
                    <button
                      onClick={() => { setEditingChampion(null); setNewChampion({ season: '', winner: '', runnerUp: '', year: '' }); }}
                      className="bg-white/10 text-white/60 px-5 py-2 rounded-xl font-condensed font-bold text-[10px] uppercase tracking-widest hover:bg-white/20 transition-all"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-4">
              {champions.length === 0 ? (
                <div className="text-center py-16 glass rounded-xl">
                  <Trophy className="mx-auto text-white/10 mb-4" size={48} />
                  <p className="text-white/40 font-condensed tracking-widest uppercase text-xs">No champions recorded yet</p>
                </div>
              ) : (
                [...champions].reverse().map((c, i) => {
                  const actualIndex = champions.length - 1 - i;
                  const isLatest = i === 0;
                  return (
                    <div key={actualIndex} className={`glass rounded-xl p-6 flex items-center gap-6 ${isLatest ? 'border-2 border-yellow-400/30 bg-yellow-400/5' : 'border border-white/5'}`}>
                      <div className={`w-14 h-14 rounded-xl flex items-center justify-center ${isLatest ? 'bg-yellow-400/20' : 'bg-white/5'}`}>
                        <Trophy className={isLatest ? 'text-yellow-400' : 'text-white/20'} size={28} />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-display text-xl uppercase tracking-wider">{c.winner}</span>
                          {isLatest && <span className="bg-yellow-400 text-pl-ink text-[8px] font-bold px-2 py-0.5 rounded uppercase tracking-wider">Current</span>}
                        </div>
                        <div className="text-[10px] font-condensed text-white/40 uppercase tracking-widest mt-1">
                          {c.season}{c.year ? ` • ${c.year}` : ''}
                          {c.runnerUp ? ` • Runner-up: ${c.runnerUp}` : ''}
                        </div>
                      </div>
                      {isAdmin && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => { setEditingChampion(actualIndex); setNewChampion(c); }}
                            className="text-white/30 hover:text-yellow-400 transition-colors"
                          >
                            <Edit3 size={14} />
                          </button>
                          <button
                            onClick={() => removeChampion(actualIndex)}
                            className="text-white/30 hover:text-red-400 transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
        )}

        {activeTab === 'wc' && (
          <motion.div
            key="wc"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-8 pb-20"
          >
            <div className="text-center mb-8">
              <h2 className="font-display text-4xl md:text-5xl font-bold uppercase">
                WORLD <span className="text-pl-cyan">CUP</span>
              </h2>
              <p className="text-white/40 font-condensed uppercase tracking-widest text-xs mt-2">Pick your nation. Represent your flag.</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Group A */}
              <div className="glass rounded-xl overflow-hidden border border-white/10">
                <div className="bg-gradient-to-r from-red-500/20 to-red-500/5 px-4 py-3 border-b border-white/10">
                  <h3 className="font-display text-lg font-bold uppercase tracking-wider">
                    Group <span className="text-red-400">A</span>
                  </h3>
                </div>
                <div className="divide-y divide-white/5">
                  {[
                    { flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', name: 'England' },
                    { flag: '🇩🇪', name: 'Germany' },
                    { flag: '🇬🇭', name: 'Ghana' },
                    { flag: '🇲🇽', name: 'Mexico' },
                  ].map((team) => (
                    <div key={team.name} className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors">
                      <span className="text-xl">{team.flag}</span>
                      <span className="font-condensed font-bold text-[11px] uppercase tracking-wide text-white/90">{team.name}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Group B */}
              <div className="glass rounded-xl overflow-hidden border border-white/10">
                <div className="bg-gradient-to-r from-blue-500/20 to-blue-500/5 px-4 py-3 border-b border-white/10">
                  <h3 className="font-display text-lg font-bold uppercase tracking-wider">
                    Group <span className="text-blue-400">B</span>
                  </h3>
                </div>
                <div className="divide-y divide-white/5">
                  {[
                    { flag: '🇫🇷', name: 'France' },
                    { flag: '🇮🇹', name: 'Italy' },
                    { flag: '🇲🇦', name: 'Morocco' },
                    { flag: '🇳🇱', name: 'Netherlands' },
                  ].map((team) => (
                    <div key={team.name} className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors">
                      <span className="text-xl">{team.flag}</span>
                      <span className="font-condensed font-bold text-[11px] uppercase tracking-wide text-white/90">{team.name}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Group C */}
              <div className="glass rounded-xl overflow-hidden border border-white/10">
                <div className="bg-gradient-to-r from-emerald-500/20 to-emerald-500/5 px-4 py-3 border-b border-white/10">
                  <h3 className="font-display text-lg font-bold uppercase tracking-wider">
                    Group <span className="text-emerald-400">C</span>
                  </h3>
                </div>
                <div className="divide-y divide-white/5">
                  {[
                    { flag: '🇦🇷', name: 'Argentina' },
                    { flag: '🇵🇹', name: 'Portugal' },
                    { flag: '🇭🇷', name: 'Croatia' },
                    { flag: '🇸🇪', name: 'Sweden' },
                  ].map((team) => (
                    <div key={team.name} className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors">
                      <span className="text-xl">{team.flag}</span>
                      <span className="font-condensed font-bold text-[11px] uppercase tracking-wide text-white/90">{team.name}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Group D */}
              <div className="glass rounded-xl overflow-hidden border border-white/10">
                <div className="bg-gradient-to-r from-amber-500/20 to-amber-500/5 px-4 py-3 border-b border-white/10">
                  <h3 className="font-display text-lg font-bold uppercase tracking-wider">
                    Group <span className="text-amber-400">D</span>
                  </h3>
                </div>
                <div className="divide-y divide-white/5">
                  {[
                    { flag: '🇩🇰', name: 'Denmark' },
                    { flag: '🇵🇱', name: 'Poland' },
                    { flag: '🇪🇸', name: 'Spain' },
                    { flag: '🇺🇸', name: 'USA' },
                  ].map((team) => (
                    <div key={team.name} className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors">
                      <span className="text-xl">{team.flag}</span>
                      <span className="font-condensed font-bold text-[11px] uppercase tracking-wide text-white/90">{team.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'admin' && isAdmin && (
          <div className="space-y-12 pb-20">
            {/* Stats Overview */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Total Users', value: allUsers.length, icon: Users, color: 'text-pl-cyan' },
                { label: 'Total Players', value: uniquePlayers.length, icon: Trophy, color: 'text-pl-pink' },
                { label: 'League Matches', value: fixtures.length, icon: Swords, color: 'text-pl-purple' },
                { label: 'UEFA Matches', value: uefaFixtures.length, icon: ShieldCheck, color: 'text-emerald-400' },
              ].map((stat, i) => (
                <div key={i} className="glass p-6 rounded-2xl border-b-2 border-white/5">
                  <stat.icon className={`${stat.color} mb-3`} size={20} />
                  <p className="text-[10px] font-condensed text-white/40 uppercase tracking-widest">{stat.label}</p>
                  <p className="text-2xl font-display mt-1">{stat.value}</p>
                </div>
              ))}
            </div>

            {/* Quick Actions */}
            <div className="glass p-8 rounded-2xl border-l-4 border-pl-cyan">
              <div className="flex items-center gap-4 mb-8">
                <div className="w-12 h-12 bg-pl-cyan/10 rounded-xl flex items-center justify-center">
                  <ShieldCheck className="text-pl-cyan" size={24} />
                </div>
                <div>
                  <h2 className="font-display text-2xl uppercase tracking-wider">Quick <span className="text-pl-cyan">Actions</span></h2>
                  <p className="text-white/40 font-condensed uppercase tracking-widest text-[10px]">Global league management tools</p>
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <button 
                  onClick={() => setShowSeasonModal(true)}
                  className="flex flex-col items-center justify-center p-6 glass rounded-xl hover:bg-pl-cyan/10 transition-all group border border-white/5"
                >
                  <Calendar className="text-pl-cyan mb-3 group-hover:scale-110 transition-transform" size={24} />
                  <span className="font-condensed font-bold text-xs uppercase tracking-widest">Manage Seasons</span>
                </button>
                <button 
                  onClick={generatePlayoffs}
                  className="flex flex-col items-center justify-center p-6 glass rounded-xl hover:bg-pl-purple/10 transition-all group border border-white/5"
                >
                  <Swords className="text-pl-purple mb-3 group-hover:scale-110 transition-transform" size={24} />
                  <span className="font-condensed font-bold text-xs uppercase tracking-widest">Generate Playoffs</span>
                </button>
                <button 
                  onClick={() => setShowPreseasonModal(true)}
                  className="flex flex-col items-center justify-center p-6 glass rounded-xl hover:bg-pl-pink/10 transition-all group border border-white/5"
                >
                  <Plus className="text-pl-pink mb-3 group-hover:scale-110 transition-transform" size={24} />
                  <span className="font-condensed font-bold text-xs uppercase tracking-widest">Add Preseason Match</span>
                </button>
                <button
                  onClick={endLeague}
                  className="flex flex-col items-center justify-center p-6 glass rounded-xl hover:bg-amber-500/10 transition-all group border border-white/5"
                >
                  <CheckCircle2 className="text-amber-400 mb-3 group-hover:scale-110 transition-transform" size={24} />
                  <span className="font-condensed font-bold text-xs uppercase tracking-widest">End League</span>
                  <span className="text-[8px] font-condensed text-white/30 uppercase tracking-widest mt-1">Cancel pending & lock table</span>
                </button>
                <button
                  onClick={resetLeague}
                  className="flex flex-col items-center justify-center p-6 glass rounded-xl hover:bg-red-500/10 transition-all group border border-white/5"
                >
                  <Trash2 className="text-red-500 mb-3 group-hover:scale-110 transition-transform" size={24} />
                  <span className="font-condensed font-bold text-xs uppercase tracking-widest">Reset All Fixtures</span>
                </button>
                <button 
                  onClick={() => setActiveTab('news')}
                  className="flex flex-col items-center justify-center p-6 glass rounded-xl hover:bg-pl-purple/10 transition-all group border border-white/5"
                >
                  <Newspaper className="text-pl-purple mb-3 group-hover:scale-110 transition-transform" size={24} />
                  <span className="font-condensed font-bold text-xs uppercase tracking-widest">Manage News</span>
                </button>
              </div>
            </div>

            {/* Player Management */}
            <div className="grid lg:grid-cols-1 gap-8">
              {/* Player Management */}
              <div className="glass p-8 rounded-2xl border-l-4 border-emerald-400">
                <div className="flex items-center gap-4 mb-8">
                  <div className="w-12 h-12 bg-emerald-400/10 rounded-xl flex items-center justify-center">
                    <Trophy className="text-emerald-400" size={24} />
                  </div>
                  <div>
                    <h2 className="font-display text-2xl uppercase tracking-wider">Player <span className="text-emerald-400">Database</span></h2>
                    <p className="text-white/40 font-condensed uppercase tracking-widest text-[10px]">Global list of all league participants</p>
                  </div>
                </div>

                <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2 no-scrollbar">
                  {uniquePlayers.sort((a, b) => a.name.localeCompare(b.name)).map((p) => (
                    <div 
                      key={p.id} 
                      onClick={() => {
                        setSelectedPlayer(p);
                        setPlayerBio(p.bio || '');
                        setShowPlayerModal(true);
                      }}
                      className="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 transition-all cursor-pointer group"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-xl bg-emerald-400/10 flex items-center justify-center text-emerald-400 font-bold group-hover:bg-emerald-400/20 transition-colors">
                          {p.name.charAt(0)}
                        </div>
                        <div>
                          <div className="font-bold text-sm">{p.name}</div>
                          {/* Club display removed */}
                        </div>
                      </div>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          deletePlayer(p.id);
                        }}
                        className="text-white/20 hover:text-red-500 transition-colors p-2"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Admin Email Management */}
            <div className="glass p-8 rounded-2xl border-l-4 border-pl-cyan">
              <div className="flex items-center gap-4 mb-8">
                <div className="w-12 h-12 bg-pl-cyan/10 rounded-xl flex items-center justify-center">
                  <ShieldCheck className="text-pl-cyan" size={24} />
                </div>
                <div>
                  <h2 className="font-display text-2xl uppercase tracking-wider">Admin <span className="text-pl-cyan">Access</span></h2>
                  <p className="text-white/40 font-condensed uppercase tracking-widest text-[10px]">Manage which emails have admin login</p>
                </div>
              </div>

              <div className="flex gap-2 mb-6">
                <input
                  type="email"
                  value={newAdminEmail}
                  onChange={(e) => setNewAdminEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addAdminEmail()}
                  placeholder="email@example.com"
                  className="flex-1 bg-pl-ink border border-white/10 rounded-xl px-4 py-3 text-xs focus:border-pl-cyan outline-none transition-colors"
                />
                <button
                  onClick={addAdminEmail}
                  className="bg-pl-cyan text-pl-ink px-5 rounded-xl font-condensed font-bold text-[10px] uppercase tracking-widest hover:brightness-110 transition-all"
                >
                  Add
                </button>
              </div>

              <div className="space-y-2 max-h-60 overflow-y-auto no-scrollbar">
                {['olaniyantoheebola@gmail.com', 'thelegendaryeman@gmail.com', 'alikibogy@gmail.com'].map(email => (
                  <div key={email} className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5">
                    <span className="text-xs text-white/60 font-mono">{email}</span>
                    <span className="text-[8px] font-condensed text-white/30 uppercase tracking-widest">Built-in</span>
                  </div>
                ))}
                {adminEmails.map(email => (
                  <div key={email} className="flex items-center justify-between p-3 rounded-xl bg-pl-cyan/5 border border-pl-cyan/10">
                    <span className="text-xs text-white/80 font-mono">{email}</span>
                    <button
                      onClick={() => removeAdminEmail(email)}
                      className="text-red-400/60 hover:text-red-400 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                {adminEmails.length === 0 && (
                  <p className="text-[10px] text-white/20 uppercase tracking-widest text-center py-4">No additional admins added yet</p>
                )}
              </div>
            </div>

            {/* Bulk Results */}
            <div className="max-w-2xl mx-auto">
              <div className="glass p-8 rounded-2xl border-l-4 border-pl-pink">
                <div className="flex items-center gap-4 mb-6">
                  <div className="w-12 h-12 bg-pl-pink/10 rounded-xl flex items-center justify-center">
                    <Trophy className="text-pl-pink" size={24} />
                  </div>
                  <div>
                    <h2 className="font-display text-2xl uppercase tracking-wider">Bulk <span className="text-pl-pink">Results</span></h2>
                    <p className="text-white/40 font-condensed uppercase tracking-widest text-[10px]">Upload match scores in bulk</p>
                  </div>
                </div>
                
                <div className="space-y-4">
                  <p className="text-[10px] text-white/40 uppercase tracking-widest leading-relaxed">
                    Format: <span className="text-pl-cyan">Home Team X-Y Away Team</span> (One per line)<br/>
                    Example: <span className="text-white/60 italic">Shatta 2-1 Movement</span>
                  </p>
                  <textarea 
                    value={bulkResultsText}
                    onChange={(e) => setBulkResultsText(e.target.value)}
                    placeholder="Paste results here..."
                    className="w-full bg-pl-ink border border-white/10 rounded-xl p-4 text-xs text-white/80 focus:border-pl-pink outline-none transition-colors h-40 resize-none font-mono"
                  />
                  <button 
                    onClick={bulkUploadResults}
                    className="w-full bg-pl-pink text-white py-4 rounded-xl font-condensed font-bold text-xs uppercase tracking-widest hover:brightness-110 transition-all"
                  >
                    Upload Scores
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Auction Modal */}
      {showAuctionModal && auctionPlayer && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 bg-pl-ink/90 backdrop-blur-sm"
            onClick={() => setShowAuctionModal(false)}
          />
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="glass rounded-2xl p-8 w-full max-w-md relative z-10"
          >
            <h3 className="font-display text-xl uppercase tracking-widest text-pl-cyan mb-2">Start Auction</h3>
            <p className="text-[10px] font-condensed text-white/40 uppercase tracking-[0.2em] mb-8">List {auctionPlayer.name} on the Transfer Market</p>
            
            <div className="space-y-6 mb-8">
              <div>
                <label className="block text-[10px] font-condensed text-white/40 uppercase tracking-widest mb-2">Starting Bid (Millions)</label>
                <input 
                  type="number" 
                  value={bidAmount}
                  onChange={(e) => setBidAmount(parseInt(e.target.value) || 0)}
                  className="w-full bg-pl-ink border border-white/10 rounded px-4 py-3 text-sm focus:border-pl-cyan outline-none transition-colors" 
                  placeholder="e.g. 10"
                />
              </div>
              <div className="bg-white/5 p-4 rounded-xl border border-white/5">
                <p className="text-[10px] text-white/40 leading-relaxed uppercase tracking-wider">
                  Note: Once started, the auction will run for 24 hours. You cannot cancel an active auction if there are bids.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button 
                onClick={() => startAuction(auctionPlayer, bidAmount)}
                className="bg-pl-cyan text-pl-ink py-4 rounded-lg font-condensed font-bold text-xs uppercase tracking-widest hover:brightness-110 transition-all"
              >
                Start Auction
              </button>
              <button 
                onClick={() => setShowAuctionModal(false)}
                className="bg-white/5 text-white/60 py-4 rounded-lg font-condensed font-bold text-xs uppercase tracking-widest hover:bg-white/10 transition-all"
              >
                Cancel
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Season Management Modal */}
      {showSeasonModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 bg-pl-ink/90 backdrop-blur-sm"
            onClick={() => setShowSeasonModal(false)}
          />
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="glass rounded-2xl p-8 w-full max-w-md relative z-10"
          >
            <h3 className="font-display text-xl uppercase tracking-widest text-pl-cyan mb-6">Manage Seasons</h3>
            
            <div className="space-y-4 mb-8">
              <div>
                <label className="block text-[10px] font-condensed text-white/40 uppercase tracking-widest mb-2">New Season Name</label>
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    value={newSeasonName}
                    onChange={(e) => setNewSeasonName(e.target.value)}
                    placeholder="e.g. Season 2, Winter 2026..."
                    className="flex-1 bg-pl-ink border border-white/10 rounded-xl px-4 py-3 text-xs focus:border-pl-cyan outline-none transition-colors"
                  />
                  <button 
                    onClick={addSeason}
                    className="bg-pl-cyan text-pl-ink px-4 rounded-xl font-condensed font-bold text-[10px] uppercase tracking-widest hover:brightness-110"
                  >
                    Create
                  </button>
                </div>
              </div>

              <div className="border-t border-white/5 pt-4">
                <label className="block text-[10px] font-condensed text-white/40 uppercase tracking-widest mb-2">All Seasons</label>
                <div className="space-y-2 max-h-48 overflow-y-auto no-scrollbar">
                  {seasons.map(s => (
                    <div key={s.id} className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5">
                      <span className="text-xs font-bold">{s.name}</span>
                      <button 
                        onClick={() => toggleSeasonActive(s.id)}
                        className={`px-3 py-1 rounded-full text-[8px] font-bold uppercase tracking-widest transition-all ${
                          s.active ? 'bg-pl-cyan text-pl-ink' : 'bg-white/10 text-white/40 hover:bg-white/20'
                        }`}
                      >
                        {s.active ? 'Active' : 'Set Active'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <button 
              onClick={() => setShowSeasonModal(false)}
              className="w-full bg-white/5 text-white/60 py-4 rounded-lg font-condensed font-bold text-xs uppercase tracking-widest hover:bg-white/10 transition-all"
            >
              Close
            </button>
          </motion.div>
        </div>
      )}

      {/* Preseason Match Modal */}
      {showPreseasonModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 bg-pl-ink/90 backdrop-blur-sm"
            onClick={() => setShowPreseasonModal(false)}
          />
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="glass rounded-2xl p-8 w-full max-w-md relative z-10"
          >
            <h3 className="font-display text-xl uppercase tracking-widest text-pl-pink mb-6">Add Preseason Match</h3>
            
            <div className="space-y-6 mb-8">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-condensed text-white/40 uppercase tracking-widest mb-2">Home Player</label>
                  <select 
                    value={preseasonFixture.homeId}
                    onChange={(e) => setPreseasonFixture({ ...preseasonFixture, homeId: e.target.value })}
                    className="w-full bg-pl-ink border border-white/10 rounded-xl px-4 py-3 text-xs focus:border-pl-pink outline-none transition-colors"
                  >
                    <option value="">Select Player</option>
                    {players.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-condensed text-white/40 uppercase tracking-widest mb-2">Away Player</label>
                  <select 
                    value={preseasonFixture.awayId}
                    onChange={(e) => setPreseasonFixture({ ...preseasonFixture, awayId: e.target.value })}
                    className="w-full bg-pl-ink border border-white/10 rounded-xl px-4 py-3 text-xs focus:border-pl-pink outline-none transition-colors"
                  >
                    <option value="">Select Player</option>
                    {players.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button 
                onClick={addPreseasonFixture}
                className="bg-pl-pink text-white py-4 rounded-lg font-condensed font-bold text-xs uppercase tracking-widest hover:brightness-110 transition-all"
              >
                Add Match
              </button>
              <button 
                onClick={() => setShowPreseasonModal(false)}
                className="bg-white/5 text-white/60 py-4 rounded-lg font-condensed font-bold text-xs uppercase tracking-widest hover:bg-white/10 transition-all"
              >
                Cancel
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Score / Fixture Detail Modal */}
      {showModal && selectedFixture && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 bg-pl-ink/90 backdrop-blur-sm"
            onClick={() => setShowModal(false)}
          />
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="glass rounded-2xl p-8 w-full max-w-lg relative z-10 max-h-[90vh] overflow-y-auto no-scrollbar"
          >
            <div className="flex justify-between items-start mb-6">
              {(() => {
                const canEdit = isAdmin;
                return (
                  <>
                    <div>
                      <h3 className="font-display text-xl uppercase tracking-widest text-pl-cyan mb-1">
                        {canEdit ? 'Enter Result' : 'Match Details'}
                      </h3>
                      <p className="text-[10px] font-condensed text-white/40 uppercase tracking-[0.2em]">Matchday {selectedFixture.matchday} • {selectedFixture.deadline}</p>
                    </div>
                    {selectedFixture.status === 'played' && (
                      <button 
                        onClick={() => shareToWhatsApp(selectedFixture)}
                        className="bg-emerald-500/10 text-emerald-500 px-3 py-1 rounded-full flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-500/20 transition-colors"
                      >
                        <MessageCircle size={12} /> Share
                      </button>
                    )}
                  </>
                );
              })()}
            </div>
            
            {(() => {
              const canEdit = isAdmin;
              return (
                <>
                  <div className="flex items-center justify-between gap-6 mb-10">
                    <div className="flex-1 text-center space-y-4">
                      <div className="font-bold text-sm truncate">{selectedFixture.homeName}</div>
                      {canEdit ? (
                        <input 
                          type="number" 
                          value={scores.home}
                          onChange={(e) => setScores({ ...scores, home: parseInt(e.target.value) || 0 })}
                          className="w-20 h-20 bg-pl-ink border-2 border-white/10 rounded-xl text-center font-display text-4xl text-pl-cyan focus:border-pl-cyan outline-none transition-colors" 
                        />
                      ) : (
                        <div className="w-20 h-20 bg-white/5 rounded-xl flex items-center justify-center font-display text-4xl text-white/60 mx-auto">
                          {selectedFixture.status === 'played' ? selectedFixture.homeScore : '-'}
                        </div>
                      )}
                    </div>
                    <div className="font-display text-2xl text-white/20 mt-8">VS</div>
                    <div className="flex-1 text-center space-y-4">
                      <div className="font-bold text-sm truncate">{selectedFixture.awayName}</div>
                      {canEdit ? (
                        <input 
                          type="number" 
                          value={scores.away}
                          onChange={(e) => setScores({ ...scores, away: parseInt(e.target.value) || 0 })}
                          className="w-20 h-20 bg-pl-ink border-2 border-white/10 rounded-xl text-center font-display text-4xl text-pl-cyan focus:border-pl-cyan outline-none transition-colors" 
                        />
                      ) : (
                        <div className="w-20 h-20 bg-white/5 rounded-xl flex items-center justify-center font-display text-4xl text-white/60 mx-auto">
                          {selectedFixture.status === 'played' ? selectedFixture.awayScore : '-'}
                        </div>
                      )}
                    </div>
                  </div>

                  {canEdit && (
                    <div className="grid grid-cols-2 gap-3 mb-10">
                      <button 
                        onClick={submitScore}
                        className="bg-pl-cyan text-pl-ink py-4 rounded-lg font-condensed font-bold text-xs uppercase tracking-widest hover:brightness-110 transition-all"
                      >
                        Confirm Score
                      </button>
                      <button 
                        onClick={() => setShowModal(false)}
                        className="bg-white/5 text-white/60 py-4 rounded-lg font-condensed font-bold text-xs uppercase tracking-widest hover:bg-white/10 transition-all"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </>
              );
            })()}

            {/* Comments Section */}
            <div className="border-t border-white/5 pt-8">
              <h4 className="font-display text-lg uppercase tracking-wider mb-6 flex items-center gap-2">
                Banter <span className="text-pl-pink">Box</span>
                <span className="text-[10px] bg-pl-pink/20 text-pl-pink px-2 py-0.5 rounded-full">
                  {comments.filter(c => c.fixtureId === selectedFixture.id).length}
                </span>
              </h4>

              <div className="space-y-4 mb-6 max-h-60 overflow-y-auto no-scrollbar pr-2">
                {comments.filter(c => c.fixtureId === selectedFixture.id).map((comment) => (
                  <div key={comment.id} className="flex gap-3 group">
                    <img src={comment.authorPhoto || undefined} alt="" className="w-8 h-8 rounded-full border border-white/10 flex-shrink-0" />
                    <div className="flex-1">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-[10px] font-bold text-pl-cyan uppercase tracking-widest">{comment.authorName}</span>
                        {(comment.authorUid === user?.uid || isAdmin) && (
                          <button 
                            onClick={() => deleteComment(comment.id)}
                            className="text-white/10 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                          >
                            <Trash2 size={10} />
                          </button>
                        )}
                      </div>
                      <div className="bg-white/5 rounded-xl p-3 text-xs text-white/70 leading-relaxed">
                        {comment.text}
                      </div>
                    </div>
                  </div>
                ))}
                {comments.filter(c => c.fixtureId === selectedFixture.id).length === 0 && (
                  <div className="text-center py-8 text-white/20 font-condensed uppercase tracking-widest text-[10px]">
                    No banter yet. Start the fire!
                  </div>
                )}
              </div>

              {isAdmin && (
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addComment(selectedFixture.id)}
                    placeholder="Type your banter..."
                    className="flex-1 bg-pl-ink border border-white/10 rounded-xl px-4 py-3 text-xs focus:border-pl-cyan outline-none transition-colors"
                  />
                  <button 
                    onClick={() => addComment(selectedFixture.id)}
                    className="bg-pl-pink text-white p-3 rounded-xl hover:scale-105 transition-transform"
                  >
                    <Send size={16} />
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}

      {/* Player Profile Modal */}
      {showPlayerModal && selectedPlayer && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 bg-pl-ink/90 backdrop-blur-sm"
            onClick={() => setShowPlayerModal(false)}
          />
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="relative glass p-8 rounded-2xl max-w-lg w-full border-l-4 border-pl-cyan shadow-2xl"
          >
            <div className="flex items-center gap-6 mb-8">
              <div className="w-20 h-20 rounded-2xl bg-pl-purple flex items-center justify-center font-display text-4xl text-pl-cyan">
                {players.findIndex(p => p.id === selectedPlayer.id) + 1}
              </div>
              <div>
                <h2 className="font-display text-3xl uppercase tracking-wider">{selectedPlayer.name}</h2>
                {/* Club display removed */}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6 mb-8">
              <div className="bg-white/5 p-4 rounded-xl border border-white/5">
                <div className="text-[10px] font-condensed text-white/40 uppercase tracking-widest mb-2">Current Form</div>
                <div className="flex gap-1">
                  {getPlayerForm(selectedPlayer.id).length > 0 ? (
                    getPlayerForm(selectedPlayer.id).map((res, i) => (
                      <span key={i} className={`w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold ${
                        res === 'W' ? 'bg-green-500 text-white' : 
                        res === 'L' ? 'bg-red-500 text-white' : 
                        'bg-yellow-500 text-pl-ink'
                      }`}>
                        {res}
                      </span>
                    ))
                  ) : (
                    <span className="text-[10px] text-white/20 uppercase tracking-widest">No matches played</span>
                  )}
                </div>
              </div>
              <div className="bg-white/5 p-4 rounded-xl border border-white/5">
                <div className="text-[10px] font-condensed text-white/40 uppercase tracking-widest mb-2">Status</div>
                <div className="text-xs font-bold text-white/80 uppercase tracking-widest">Active Squad</div>
              </div>
            </div>

            <div className="space-y-4 mb-8">
              <label className="block text-[10px] font-condensed text-white/40 uppercase tracking-widest">Player Biography</label>
              <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                <textarea 
                  value={playerBio}
                  onChange={(e) => setPlayerBio(e.target.value)}
                  placeholder="Enter a brief bio for this player..."
                  className="w-full bg-transparent p-4 text-sm text-white/80 focus:bg-white/5 outline-none transition-all h-32 resize-none border-none"
                />
              </div>
              <p className="text-[9px] text-white/20 uppercase tracking-widest text-right">Max 1000 characters</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button 
                onClick={updatePlayerBio}
                className="bg-pl-cyan text-pl-ink py-4 rounded-lg font-condensed font-bold text-xs uppercase tracking-widest hover:brightness-110 transition-all"
              >
                Save Profile
              </button>
              <button 
                onClick={() => setShowPlayerModal(false)}
                className="bg-white/5 text-white/60 py-4 rounded-lg font-condensed font-bold text-xs uppercase tracking-widest hover:bg-white/10 transition-all"
              >
                Close
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* News Modal */}
      {showNewsModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 bg-pl-ink/90 backdrop-blur-sm"
            onClick={() => setShowNewsModal(false)}
          />
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="glass rounded-2xl p-8 w-full max-w-lg relative z-10"
          >
            <h3 className="font-display text-xl uppercase tracking-widest text-pl-cyan mb-2">
              {editingNews ? 'Edit Article' : 'Create Article'}
            </h3>
            <p className="text-[10px] font-condensed text-white/40 uppercase tracking-[0.2em] mb-8">Post updates to the SHATTA MOVEMENT LEAGUE news feed</p>
            
            <div className="space-y-6 mb-8">
              <div>
                <label className="block text-[10px] font-condensed text-white/40 uppercase tracking-widest mb-2">Title</label>
                <input 
                  type="text" 
                  value={newNews.title}
                  onChange={(e) => setNewNews({ ...newNews, title: e.target.value })}
                  className="w-full bg-pl-ink border border-white/10 rounded px-4 py-3 text-sm focus:border-pl-cyan outline-none transition-colors" 
                  placeholder="e.g. Matchday 5 Highlights"
                />
              </div>
              <div>
                <label className="block text-[10px] font-condensed text-white/40 uppercase tracking-widest mb-2">Content</label>
                <textarea 
                  value={newNews.content}
                  onChange={(e) => setNewNews({ ...newNews, content: e.target.value })}
                  className="w-full bg-pl-ink border border-white/10 rounded px-4 py-3 text-sm focus:border-pl-cyan outline-none transition-colors h-40 resize-none" 
                  placeholder="Write your article here..."
                />
              </div>
              <div>
                <label className="block text-[10px] font-condensed text-white/40 uppercase tracking-widest mb-2">Image URL (Optional)</label>
                <input 
                  type="text" 
                  value={newNews.imageUrl}
                  onChange={(e) => setNewNews({ ...newNews, imageUrl: e.target.value })}
                  className="w-full bg-pl-ink border border-white/10 rounded px-4 py-3 text-sm focus:border-pl-cyan outline-none transition-colors" 
                  placeholder="https://images.unsplash.com/..."
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button 
                onClick={editingNews ? updateNews : addNews}
                className="bg-pl-cyan text-pl-ink py-4 rounded-lg font-condensed font-bold text-xs uppercase tracking-widest hover:brightness-110 transition-all"
              >
                {editingNews ? 'Update News' : 'Post News'}
              </button>
              <button 
                onClick={() => setShowNewsModal(false)}
                className="bg-white/5 text-white/60 py-4 rounded-lg font-condensed font-bold text-xs uppercase tracking-widest hover:bg-white/10 transition-all"
              >
                Cancel
              </button>
            </div>
          </motion.div>
        </div>
      )}

      <footer className="bg-pl-ink border-t border-white/5 py-10 px-6">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-pl-pink flex items-center justify-center font-display text-lg">SM</div>
            <div className="font-condensed font-bold text-[10px] uppercase tracking-[0.3em]">SHATTA MOVEMENT LEAGUE</div>
          </div>
          <div className="text-white/20 font-condensed text-[10px] uppercase tracking-widest">
            Built for the SHATTA MOVEMENT Community • 2026
          </div>
        </div>
      </footer>
    </div>
  );
}

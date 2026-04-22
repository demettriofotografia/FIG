import React, { useState, useEffect, useMemo } from 'react';
import { 
  TrendingUp, 
  TrendingDown, 
  AlertTriangle,
  ArrowUpRight,
  ChevronRight,
  MoreVertical,
  Lock,
  User,
  LogIn,
  LogOut
} from 'lucide-react';
import { 
  PieChart, 
  Pie, 
  Cell, 
  ResponsiveContainer, 
  Tooltip as RechartsTooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  AreaChart,
  Area
} from 'recharts';
import { motion, AnimatePresence } from 'motion/react';
import Papa from 'papaparse';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// --- Utilities ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
};

// --- Types ---
interface DayData {
  day: number;
  displayDay?: number;
  displayLabel?: string;
  risk: number;
  profit: number;
  withdrawals: number;
  operations: number;
  hits: number;
  errors: number;
  isNonWorkingDay?: boolean;
}

interface Summary {
  initialBalance: number;
  totalProfit: number;
  totalWithdrawals: number;
  totalOperations: number;
  totalHits: number;
  totalErrors: number;
  winRate: number;
  dailyRisk: number;
  taxes: number;
  availableBalance: number;
}

const DEFAULT_SPREADSHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vT6zXjo6h4Y64wnFq1_U_z4DtpIG4OM6JlII1mTVPyyeS3A7WPRh15yhat_kfjRHHaWaYInOncsqf8L/pub?output=csv";

interface UserAuth {
  username: string;
  password: string;
}

export default function App() {
  const [data, setData] = useState<DayData[]>(() => {
    const cached = localStorage.getItem('last_valid_data');
    return cached ? JSON.parse(cached) : [];
  });
  const [initialBalance, setInitialBalance] = useState<number>(() => {
    return Number(localStorage.getItem('last_balance')) || 0;
  });
  const [totalWithdrawals, setTotalWithdrawals] = useState<number>(() => {
    return Number(localStorage.getItem('last_withdrawals')) || 0;
  });
  const [allowedUsers, setAllowedUsers] = useState<UserAuth[]>(() => {
    const cached = localStorage.getItem('last_users');
    return cached ? JSON.parse(cached) : [];
  });
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    return sessionStorage.getItem('isAuth') === 'true';
  });
  const [loginForm, setLoginForm] = useState({ user: '', pass: '' });
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>(() => {
    return localStorage.getItem('last_updated_time') || '';
  });

  useEffect(() => {
    // Disable right-click
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    // Disable common DevTools shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      // F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+U
      if (
        e.key === 'F12' ||
        (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'J')) ||
        (e.ctrlKey && e.key === 'u')
      ) {
        e.preventDefault();
      }
    };

    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  useEffect(() => {
    const fetchData = async (isInitial = true) => {
      try {
        if (isInitial) setLoading(true);
        setError(null);
        
        const envUrl = (import.meta as any).env.VITE_SPREADSHEET_URL;
        let baseUsedUrl = envUrl || DEFAULT_SPREADSHEET_URL;
        
        // Clean URL whitespace
        baseUsedUrl = baseUsedUrl.trim();

        // Basic check for "Published to web" format
        const isPublished = baseUsedUrl.includes('/pub') || baseUsedUrl.includes('/d/e/');
        const isExport = baseUsedUrl.includes('/export');
        
        if (!isPublished && !isExport && baseUsedUrl.includes('docs.google.com/spreadsheets/d/')) {
          // Attempt to convert sharing link to export link if possible
          const spreadSheetId = baseUsedUrl.match(/\/d\/([a-zA-Z0-9-_]+)/)?.[1];
          if (spreadSheetId) {
            baseUsedUrl = `https://docs.google.com/spreadsheets/d/${spreadSheetId}/export?format=csv`;
          }
        }

        // Cache busting only if it's a published link (export links sometimes fail with extra params)
        const usedUrl = baseUsedUrl.includes('?') 
          ? `${baseUsedUrl}&_cb=${Date.now()}` 
          : `${baseUsedUrl}?_cb=${Date.now()}`;
        
        let response;
        try {
          response = await fetch(usedUrl);
        } catch (fetchErr) {
          console.warn("Direct fetch failed, trying proxy fallback...", fetchErr);
          // Fallback to a proxy if direct fetch fails (sometimes helps with specific CORS/Network issues)
          const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(usedUrl)}`;
          const proxyResponse = await fetch(proxyUrl);
          if (!proxyResponse.ok) throw fetchErr;
          
          const proxyData = await proxyResponse.json();
          const csvText = proxyData.contents;
          if (!csvText || csvText.length < 10) throw new Error("Falha ao recuperar dados via proxy.");
          
          // Mimic a response object or just process text directly
          return processCsv(csvText);
        }
        
        if (!response.ok) {
          if (response.status === 400) {
            throw new Error("Erro 400: Parâmetros inválidos. Certifique-se de que a planilha foi 'Publicada na Web' (Arquivo > Compartilhar > Publicar na Web) selecionando 'Valores separados por vírgula (.csv)' e que o link utilizado seja o link de publicação, não o link de edição.");
          }
          if (response.status === 404) {
            throw new Error("Erro 404: Planilha não encontrada. Verifique se o link da planilha está correto e se ela ainda existe.");
          }
          throw new Error(`Erro do Servidor (${response.status}): Verifique se a planilha está publicada adequadamente como CSV.`);
        }

        const csvText = await response.text();
        processCsv(csvText);
      } catch (err: any) {
        console.error("Fetch error:", err);
        setError(err instanceof Error ? err.message : "Falha na conexão.");
        setLoading(false);
      }
    };

    const processCsv = (csvText: string) => {
      if (!csvText || csvText.length < 10) {
        throw new Error("Os dados recebidos da planilha estão incompletos ou vazios.");
      }
      
      Papa.parse(csvText, {
          header: false,
          skipEmptyLines: true,
          complete: (results) => {
            try {
              const rows = results.data as string[][];
              if (!rows || rows.length === 0) {
                setError("Planilha vazia ou com formato inválido.");
                setLoading(false);
                return;
              }

              // Helper to parse numbers from Brazilian/International formats correctly
              const parseValue = (val: string) => {
                if (!val) return 0;
                // Remove spaces and currency symbols
                const cleaned = val.trim().replace(/[^\d.,-]/g, '');
                // Logic for BR format: Dots as thousands, comma as decimal
                // We remove dots and then replace comma with dot for parseFloat
                return parseFloat(cleaned.replace(/\./g, '').replace(',', '.')) || 0;
              };

              // 1. Find Initial Balance, Risk and Total Withdrawals
              let foundInitialBalance = 5000;
              const balanceRow = rows.find(r => r[0]?.toUpperCase().includes("APORTE INICIAL"));
              if (balanceRow && balanceRow[1]) {
                foundInitialBalance = parseValue(balanceRow[1]);
              }

              let foundRisk = 0;
              const riskRow = rows.find(r => r[0]?.toUpperCase().includes("RISCO DIARIO"));
              if (riskRow && riskRow[1]) {
                foundRisk = parseValue(riskRow[1]);
              }

              // Sum withdrawals from the horizontal row "SAQUES REALIZADOS"
              let foundTotalWithdrawals = 0;
              const withdrawalRow = rows.find(r => r[0]?.toUpperCase().includes("SAQUES REALIZADOS"));
              if (withdrawalRow) {
                // Sum all cells starting from index 1 that are numbers
                for (let i = 1; i < withdrawalRow.length; i++) {
                  const val = parseValue(withdrawalRow[i]);
                  foundTotalWithdrawals += val;
                }
              }

              // 1.1 Find Access Credentials
              const foundUsers: UserAuth[] = [];
              const accessRow = rows.find(r => r[0]?.toUpperCase().includes("ACESSOS"));
              if (accessRow) {
                for (let i = 1; i < accessRow.length; i++) {
                  const cellContent = accessRow[i];
                  if (cellContent && cellContent.includes(',')) {
                    const [username, password] = cellContent.split(',').map(s => s.trim());
                    if (username && password) {
                      foundUsers.push({ username: username.toLowerCase(), password });
                    }
                  }
                }
              }
              setAllowedUsers(foundUsers);

              // 2. Logic for Business Days (Excluding Weekends and Brazilian National Holidays)
              const now = new Date();
              const year = now.getFullYear();
              const month = now.getMonth(); // 0-11
              const daysInMonth = new Date(year, month + 1, 0).getDate();

              // Brazilian National Holidays 2026 (Format: "DD/MM")
              const holidays2026 = [
                "01/01", // Confraternização Universal
                "16/02", "17/02", // Carnaval
                "03/04", // Sexta-feira Santa
                "21/04", // Tiradentes
                "01/05", // Dia do Trabalho
                "04/06", // Corpus Christi
                "07/09", // Independência
                "12/10", // Nossa Senhora Aparecida
                "02/11", // Finados
                "15/11", // Proclamação da República
                "20/11", // Dia da Consciência Negra
                "25/12"  // Natal
              ];
              
              const monthCalendarDays: { date: number, label: string, isNonWorkingDay: boolean }[] = [];
              for (let d = 1; d <= daysInMonth; d++) {
                const date = new Date(year, month, d);
                const dayOfWeek = date.getDay(); // 0 (Sun) to 6 (Sat)
                
                const dayStr = d.toString().padStart(2, '0');
                const monthStr = (month + 1).toString().padStart(2, '0');
                const dateKey = `${dayStr}/${monthStr}`;

                const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                const isHoliday = holidays2026.includes(dateKey);

                monthCalendarDays.push({ 
                  date: d, 
                  label: dateKey,
                  isNonWorkingDay: isWeekend || isHoliday
                });
              }

              // 3. Extract data following the spreadsheet sequence (DIA 01, DIA 02...)
              // Now mapped directly: DIA 01 = Day 1, DIA 02 = Day 2...
              const processedData: DayData[] = monthCalendarDays
                .filter(calDay => calDay.date <= now.getDate()) // ONLY show days up to today
                .map((calDay) => {
                  const searchLabel = `DIA ${calDay.date.toString().padStart(2, '0')}`;
                  
                  const dayRow = rows.find(r => r[0]?.toUpperCase().includes(searchLabel));
                  
                  // Lucro (Coluna B)
                  const profit = parseValue(dayRow && dayRow[1] ? dayRow[1] : "");

                  // Operações (Coluna E or contextually column 4 in array)
                  const ops = parseValue(dayRow && dayRow[4] ? dayRow[4] : "");
                  
                  return {
                    day: calDay.date,
                    displayDay: calDay.date,
                    displayLabel: calDay.label,
                    risk: foundRisk,
                    profit: profit,
                    withdrawals: 0,
                    operations: ops,
                    hits: profit > 0 ? 1 : 0,
                    errors: profit < 0 ? 1 : 0,
                    isNonWorkingDay: calDay.isNonWorkingDay
                  };
                });

              setInitialBalance(foundInitialBalance);
              setTotalWithdrawals(foundTotalWithdrawals);
              setData(processedData);
              
              const updatedTime = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
              setLastUpdated(updatedTime);
              
              // Persist valid data in case of future connection failure
              localStorage.setItem('last_valid_data', JSON.stringify(processedData));
              localStorage.setItem('last_balance', foundInitialBalance.toString());
              localStorage.setItem('last_withdrawals', foundTotalWithdrawals.toString());
              localStorage.setItem('last_users', JSON.stringify(foundUsers));
              localStorage.setItem('last_updated_time', updatedTime);
              
              setLoading(false);
            } catch (err) {
              console.error("Processing error:", err);
              setError("Erro ao processar as células da planilha.");
              setLoading(false);
            }
          },
          error: (err) => {
            console.error("Papa Parse Error:", err);
            setError("Erro ao ler as colunas da planilha.");
            setLoading(false);
          }
        });
    };

    fetchData(true);

    const interval = setInterval(() => {
      fetchData(false);
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  const summary = useMemo<Summary>(() => {
    const totals = data.reduce((acc, curr) => ({
      totalProfit: acc.totalProfit + curr.profit,
      totalWithdrawals: totalWithdrawals, // Use state-based global withdrawals
      totalOperations: acc.totalOperations + curr.operations,
      totalHits: acc.totalHits + curr.hits,
      totalErrors: acc.totalErrors + curr.errors,
    }), { totalProfit: 0, totalWithdrawals: 0, totalOperations: 0, totalHits: 0, totalErrors: 0 });

    const winRate = (totals.totalHits + totals.totalErrors) > 0 
      ? (totals.totalHits / (totals.totalHits + totals.totalErrors)) * 100 
      : 0;

    const totalPositiveProfit = data.reduce((acc, curr) => acc + (curr.profit > 0 ? curr.profit : 0), 0);
    const taxes = totalPositiveProfit * 0.19;
    const consolidatedValue = initialBalance + totals.totalProfit - totalWithdrawals;
    const availableBalance = consolidatedValue - taxes;

    const dailyRisk = data[0]?.risk || 0;

    return {
      initialBalance,
      ...totals,
      taxes,
      availableBalance,
      winRate,
      dailyRisk
    };
  }, [data, initialBalance]);

  const currentBalance = initialBalance + summary.totalProfit - summary.totalWithdrawals;

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const userMatch = allowedUsers.find(
      u => u.username === loginForm.user.toLowerCase() && u.password === loginForm.pass
    );

    if (userMatch) {
      setIsAuthenticated(true);
      sessionStorage.setItem('isAuth', 'true');
      setLoginError(null);
    } else {
      setLoginError("Usuário ou senha incorretos.");
    }
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    sessionStorage.removeItem('isAuth');
    setLoginForm({ user: '', pass: '' });
  };

  if (!isAuthenticated && !loading) {
    return (
      <div className="min-h-screen bg-[#060606] text-white font-sans font-light flex items-center justify-center p-6 relative overflow-hidden">
        {/* Dynamic Background Effects (Copied for consistency) */}
        <div className="fixed inset-0 z-0 pointer-events-none">
          <div className="absolute inset-0 bg-dot-pattern opacity-40"></div>
          <div className="absolute -top-1/4 -left-1/4 w-[80%] h-[80%] animated-gradient opacity-30" />
          <div className="absolute -bottom-1/4 -right-1/4 w-[70%] h-[70%] animated-gradient opacity-20" />
        </div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative z-10 w-full max-w-[400px] glass-card p-12 text-center"
        >
          <div className="mb-12 flex flex-col items-center justify-center">
            <img 
              src="https://lh3.googleusercontent.com/d/1IG128FJsxnPPIy1y2XzmRW3fLSxFxktZ" 
              alt="Central FIG Logo" 
              className="h-16 md:h-14 w-auto object-contain"
              referrerPolicy="no-referrer"
            />
          </div>
          
          <div className="mb-10">
            <h1 className="text-2xl font-light tracking-tight mb-2">Acesso Restrito</h1>
            <p className="text-gray-500 text-sm tracking-wide">Entre com suas credenciais para acessar o Dashboard.</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-6">
            <div className="space-y-4">
              <div className="relative group">
                <User size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-600 transition-colors group-focus-within:text-orange-500" />
                <input 
                  type="text" 
                  placeholder="Usuário"
                  value={loginForm.user}
                  onChange={(e) => setLoginForm({ ...loginForm, user: e.target.value })}
                  className="w-full bg-white/[0.03] border border-white/5 rounded-md py-4 pl-12 pr-4 text-sm focus:outline-none focus:border-orange-500/50 focus:bg-white/[0.05] transition-all placeholder:text-gray-700"
                  required
                />
              </div>
              <div className="relative group">
                <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-600 transition-colors group-focus-within:text-orange-500" />
                <input 
                  type="password" 
                  placeholder="Senha"
                  value={loginForm.pass}
                  onChange={(e) => setLoginForm({ ...loginForm, pass: e.target.value })}
                  className="w-full bg-white/[0.03] border border-white/5 rounded-md py-4 pl-12 pr-4 text-sm focus:outline-none focus:border-orange-500/50 focus:bg-white/[0.05] transition-all placeholder:text-gray-700"
                  required
                />
              </div>
            </div>

            {loginError && (
              <motion.p 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-xs text-rose-500 font-medium"
              >
                {loginError}
              </motion.p>
            )}

            <button 
              type="submit"
              className="w-full bg-orange-500 py-4 rounded-md text-sm font-semibold uppercase tracking-[0.2em] transition-all hover:bg-orange-600 hover:shadow-[0_0_20px_rgba(249,115,22,0.3)] active:scale-[0.98]"
            >
              Entrar no Dashboard
            </button>
          </form>

          <p className="mt-12 text-[10px] text-gray-600 uppercase font-bold tracking-widest">Acesso Seguro & Criptografado</p>
        </motion.div>
      </div>
    );
  }

  if (loading && data.length === 0) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#060606]">
        <motion.div 
          animate={{ scale: [1, 1.1, 1], opacity: [0.5, 1, 0.5] }}
          transition={{ repeat: Infinity, duration: 1.5 }}
          className="flex flex-col items-center gap-4"
        >
          <div className="w-12 h-12 rounded-full border-2 border-orange-500 border-t-transparent animate-spin"></div>
          <span className="text-orange-500 font-medium z-50 text-center uppercase tracking-widest text-[10px]">
            Otimizando Relatório
          </span>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#060606] text-white font-sans font-light relative overflow-hidden select-none">
      {/* Dynamic Background Effects */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        {/* Particle Grid Overlay */}
        <div className="absolute inset-0 bg-dot-pattern opacity-40"></div>
        
        {/* Glow Effects */}
        <motion.div 
          animate={{ 
            x: [0, 50, -50, 0],
            y: [0, -30, 30, 0],
          }}
          transition={{ repeat: Infinity, duration: 20, ease: "linear" }}
          className="absolute -top-1/4 -left-1/4 w-[80%] h-[80%] animated-gradient opacity-30" 
        />
        <motion.div 
          animate={{ 
            x: [0, -40, 40, 0],
            y: [0, 50, -50, 0],
          }}
          transition={{ repeat: Infinity, duration: 25, ease: "linear" }}
          className="absolute -bottom-1/4 -right-1/4 w-[70%] h-[70%] animated-gradient opacity-20" 
        />

        {/* Floating Particles */}
        <div className="absolute inset-0">
          {Array.from({ length: 40 }).map((_, i) => (
            <motion.div
              key={i}
              initial={{ 
                x: Math.random() * 2000, 
                y: Math.random() * 2000,
                opacity: Math.random() * 0.3
              }}
              animate={{ 
                y: [null, -100, Math.random() * 100],
                opacity: [null, 0.5, 0.2]
              }}
              transition={{ 
                repeat: Infinity, 
                duration: Math.random() * 10 + 10,
                ease: "linear" 
              }}
              className="absolute w-0.5 h-0.5 bg-orange-400 rounded-full blur-[1px]"
            />
          ))}
        </div>
      </div>

      {/* Main Content */}
      <main className="relative z-10 max-w-[1400px] mx-auto p-6 md:p-12 space-y-12">
        {/* Header with Branding & Logout */}
        <div className="flex items-center justify-center md:justify-between z-20 relative">
          <div className="flex items-center gap-4">
            <img 
              src="https://lh3.googleusercontent.com/d/1IG128FJsxnPPIy1y2XzmRW3fLSxFxktZ" 
              alt="Central FIG Logo" 
              className="h-12 md:h-10 w-auto object-contain"
              referrerPolicy="no-referrer"
            />
            {lastUpdated && (
              <div className="hidden md:flex flex-col ml-2 border-l border-white/10 pl-4">
                <span className="text-[8px] uppercase tracking-widest text-gray-600 font-bold">Último Sincronismo</span>
                <span className="text-[10px] text-gray-400 font-mono">{lastUpdated}</span>
              </div>
            )}
          </div>
          
          <button 
            onClick={handleLogout}
            className="absolute right-0 md:relative flex items-center gap-2 p-2 md:px-4 md:py-2 bg-transparent md:bg-white/[0.03] border-none md:border md:border-white/5 rounded-md text-[10px] uppercase tracking-widest font-bold text-gray-500 hover:text-rose-500 transition-all group"
          >
            <LogOut size={15} className="md:w-3.5 md:h-3.5 group-hover:scale-110 transition-transform" />
            <span className="hidden md:inline">Sair do Painel</span>
          </button>
        </div>

        {error && (
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 p-5 bg-orange-500/10 border border-orange-500/20 rounded-md text-orange-200 text-sm">
            <div className="flex items-center gap-3">
              <AlertTriangle className="text-orange-500 shrink-0" size={20} />
              <p>
                {error.includes("Failed to fetch") 
                  ? "Erro de Conexão: Não foi possível alcançar a planilha. Verifique sua internet ou se a planilha está publicada com acesso público." 
                  : error} 
              </p>
            </div>
            <button 
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-orange-500/20 border border-orange-500/30 rounded text-[10px] uppercase font-bold tracking-widest hover:bg-orange-500/40 transition-colors"
            >
              Tentar Recarregar
            </button>
          </div>
        )}

        {/* Hero Section: Stats + Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
          {/* Main Balance Card */}
          <section className="lg:col-span-2 glass-card p-10 flex flex-col justify-between overflow-hidden relative group">
            <div className="absolute -top-32 -right-32 w-80 h-80 bg-orange-600/5 blur-[120px] pointer-events-none group-hover:bg-orange-600/10 transition-all duration-1000"></div>
            
            <div className="flex flex-col items-center justify-center z-10 text-center">
              <div>
                <p className="text-gray-500 text-xs font-semibold uppercase tracking-[0.2em] mb-4">Saldo Consolidado</p>
                <div className="flex flex-col items-center justify-center gap-3">
                  <h2 className="text-5xl md:text-6xl font-light tracking-tight">{formatCurrency(currentBalance)}</h2>
                  <span className={cn(
                    "text-xs font-medium px-2.5 py-1 tracking-wider uppercase",
                    summary.totalProfit >= 0 ? "text-emerald-400 bg-emerald-400/5 border border-emerald-400/20" : "text-rose-400 bg-rose-400/5 border border-rose-400/20"
                  )}>
                    {summary.totalProfit >= 0 ? "+" : ""}
                    {((summary.totalProfit / summary.initialBalance) * 100).toFixed(2)}%
                  </span>
                </div>
              </div>
            </div>

            <div className="h-[160px] md:h-[240px] mt-12 z-10 w-full">
               <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.filter(d => d.risk > 0 || d.profit !== 0)}>
                  <defs>
                    <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f97316" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#f97316" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <Area 
                    type="monotone" 
                    dataKey="profit" 
                    stroke="#f97316" 
                    strokeWidth={4}
                    fillOpacity={1} 
                    fill="url(#colorProfit)" 
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 mt-12 z-10 border-t border-white/5 pt-8">
              <StatItem label="Aporte Inicial" value={formatCurrency(summary.initialBalance)} />
              <StatItem label="Lucro Acumulado" value={formatCurrency(summary.totalProfit)} color={summary.totalProfit >= 0 ? "text-emerald-400" : "text-rose-400"} />
              <StatItem label="Taxa de Acerto" value={`${summary.winRate.toFixed(1)}%`} />
              <StatItem label="Risco Diário" value={formatCurrency(summary.dailyRisk)} />
            </div>
          </section>

          {/* Financial Breakdown Section */}
          <section className="glass-card p-10 flex flex-col justify-between">
            <div className="w-full space-y-4">
              <div className="mb-6 p-4 bg-white/[0.01] border border-white/[0.03] rounded-md text-center">
                <p className="text-[9px] text-gray-600 uppercase font-bold tracking-[0.25em] mb-1">Volume Total Acumulado</p>
                <p className="text-lg font-light text-gray-400">{formatCurrency(summary.initialBalance + summary.totalProfit)}</p>
              </div>

              <OperationRow label="Acertos" value={summary.totalHits} unit="dias" color="bg-emerald-500" />
              <OperationRow label="Erros" value={summary.totalErrors} unit="dias" color="bg-rose-500" />
              <div className="pt-4 border-t border-white/5 space-y-4">
                <OperationRow label="Saques" value={summary.totalWithdrawals} isCurrency color="bg-blue-500" />
                <OperationRow label="Taxas (19%)" value={summary.taxes} isCurrency color="bg-orange-500" />
                <div className="mt-4 p-5 bg-orange-500/10 border border-orange-500/20 rounded-md text-center">
                  <p className="text-[10px] text-orange-500 uppercase font-bold tracking-widest mb-1">VALOR LIVRE DE TAXAS</p>
                  <p className="text-2xl font-light text-white">{formatCurrency(summary.availableBalance)}</p>
                </div>
              </div>
            </div>
          </section>
        </div>

        <section className="glass-card p-10">
          <div className="flex flex-col items-center justify-center text-center mb-12">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500 mb-2">
                Registro - {new Date().toLocaleString('pt-BR', { month: 'long' })} {new Date().getFullYear()}
              </h3>
              <p className="text-xl font-light">Controle de Performance</p>
            </div>
          </div>

          <div className="w-full">
            {/* Table Header - Desktop Only */}
            <div className="hidden md:grid md:grid-cols-4 text-gray-500 text-[10px] uppercase tracking-widest font-bold px-6 mb-4">
              <div className="px-2">Data / Operação</div>
              <div className="px-2">Lucro/Prejuízo</div>
              <div className="px-2">Desempenho</div>
              <div className="px-2">Operações</div>
            </div>

            <div className="space-y-3">
              {data.map((day) => (
                <DayRow key={day.day} data={day} />
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

// --- Subcomponents ---

function StatItem({ label, value, color = "text-white" }: { label: string, value: string, color?: string }) {
  return (
    <div>
      <p className="text-gray-500 text-[10px] font-semibold uppercase tracking-[0.2em] mb-2">{label}</p>
      <p className={cn("text-xl font-light tracking-tight", color)}>{value}</p>
    </div>
  );
}

function OperationRow({ label, value, color, unit, isCurrency }: { label: string, value: number, color: string, unit?: string, isCurrency?: boolean }) {
  return (
    <div className="flex items-center justify-between p-4 bg-white/[0.02] border border-white/5 rounded-md transition-colors hover:bg-white/[0.04]">
      <div className="flex items-center gap-4">
        <div className={cn("w-2 h-2 rounded-full", color)}></div>
        <span className="text-xs uppercase tracking-widest font-medium text-gray-400">{label}</span>
      </div>
      <span className="text-lg font-light">
        {isCurrency ? formatCurrency(value) : `${value} ${unit || ''}`}
      </span>
    </div>
  );
}

const DayRow: React.FC<{ data: DayData }> = ({ data }) => {
  const isPositive = data.profit > 0;
  const isLoss = data.profit < 0;
  const isNeutral = data.profit === 0;

  let barFullColor = "bg-orange-500/60";
  
  if (data.profit > 10) {
    barFullColor = "bg-emerald-500/60";
  } else if (data.profit < 0) {
    barFullColor = "bg-rose-500/60";
  }

  return (
    <motion.div 
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      className={cn(
        "group border transition-all p-4 md:p-6 rounded-md md:grid md:grid-cols-4 flex flex-col gap-4 md:gap-8 items-center md:items-stretch",
        data.isNonWorkingDay 
          ? "bg-rose-500/5 border-rose-500/20" 
          : "bg-white/[0.01] border-white/[0.05] hover:bg-white/[0.03]"
      )}
    >
      {/* Col 1: Date/Op & Profit (Mobile side-by-side) */}
      <div className="flex items-center gap-4 w-full md:w-auto justify-between md:justify-start">
        <div className="flex items-center gap-4">
          <span className={cn(
            "text-xs font-mono font-bold transition-colors tracking-tighter",
            data.isNonWorkingDay ? "text-rose-500" : "text-gray-600 group-hover:text-orange-500"
          )}>
            {data.displayLabel || data.day.toString().padStart(2, '0')}
          </span>
          <span className="text-sm font-medium tracking-wide uppercase">Dia {data.day}</span>
        </div>
        
        {/* Profit on the right side for Mobile Only */}
        <div className="md:hidden flex flex-col items-end">
          <span className={cn(
            "text-sm font-medium tracking-tight",
            isPositive ? "text-emerald-400" : isLoss ? "text-rose-400" : "text-orange-400"
          )}>
            {data.profit > 0 ? "+" : ""}{formatCurrency(data.profit)}
          </span>
          <span className="text-[9px] text-gray-600 uppercase font-bold tracking-widest leading-none">Lucro</span>
        </div>
      </div>

      {/* Col 2: Profit (Desktop Only) */}
      <div className="hidden md:flex flex-col items-center md:items-start w-full md:w-auto">
        <span className={cn(
          "text-sm font-medium tracking-tight",
          isPositive ? "text-emerald-400" : isLoss ? "text-rose-400" : "text-orange-400"
        )}>
          {data.profit > 0 ? "+" : ""}{formatCurrency(data.profit)}
        </span>
        <span className="text-[10px] text-gray-600 uppercase font-bold tracking-widest">Lucro</span>
      </div>

      {/* Col 3: Performance Bar */}
      <div className="flex items-center gap-4 min-w-0 w-full md:w-auto px-0 md:px-4">
        <div className="flex-1 h-[2px] bg-white/5 relative">
          <motion.div 
            initial={{ width: 0 }}
            animate={{ width: isNeutral ? '20%' : '100%' }}
            className={cn("h-full transition-all duration-1000", barFullColor)}
          />
        </div>
        <span className={cn(
          "text-[9px] font-bold uppercase tracking-[0.2em] shrink-0",
          data.isNonWorkingDay ? "text-rose-500/50" : (isPositive ? "text-emerald-500" : isLoss ? "text-rose-500" : "text-orange-500")
        )}>
          {data.isNonWorkingDay ? "OFF" : (isPositive ? "Win" : isLoss ? "Loss" : "Flat")}
        </span>
      </div>

      {/* Col 4: Operations Bars */}
      <div className="flex items-center justify-between md:justify-start gap-4 w-full md:w-auto md:pl-8">
        <div className="flex items-center gap-1.5 shrink-0">
          {Array.from({ length: 4 }).map((_, i) => {
            let activeBars = 0;
            let barColor = "bg-white/5";
            
            if (data.operations < 10) {
              activeBars = 4;
              barColor = "bg-emerald-500/60";
            } else if (data.operations >= 10 && data.operations < 20) {
              activeBars = 3;
              barColor = "bg-yellow-500/60";
            } else if (data.operations >= 20 && data.operations < 40) {
              activeBars = 2;
              barColor = "bg-orange-500/60";
            } else {
              activeBars = 1;
              barColor = "bg-rose-500/60";
            }

            const isActive = i < activeBars;

            return (
              <div key={i} className={cn(
                "w-1 h-3 rounded-[1px] transition-all duration-500",
                isActive ? barColor : "bg-white/[0.05]"
              )} />
            );
          })}
        </div>
        <span className="text-[10px] text-gray-500 font-bold uppercase tracking-widest shrink-0">{data.operations} op.</span>
      </div>
    </motion.div>
  );
};

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
  const [data, setData] = useState<DayData[]>([]);
  const [initialBalance, setInitialBalance] = useState<number>(0);
  const [totalWithdrawals, setTotalWithdrawals] = useState<number>(0);
  const [allowedUsers, setAllowedUsers] = useState<UserAuth[]>([]);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    return sessionStorage.getItem('isAuth') === 'true';
  });
  const [loginForm, setLoginForm] = useState({ user: '', pass: '' });
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        const baseUsedUrl = envUrl || DEFAULT_SPREADSHEET_URL;
        
        // Cache busting to ensure we always get the latest version from the server
        const usedUrl = `${baseUsedUrl}${baseUsedUrl.includes('?') ? '&' : '?'}_cache_bust=${Date.now()}`;
        
        // Configuration for the fetch request
        const fetchOptions: RequestInit = {
          mode: 'cors',
          cache: 'no-cache', // Browser level cache busting
          headers: {
            'Pragma': 'no-cache',
            'Cache-Control': 'no-cache'
          }
        };

        const response = await fetch(usedUrl, fetchOptions);
        
        if (!response.ok) {
          throw new Error(`Servidor da Planilha retornou erro ${response.status}. Verifique se a planilha está publicada.`);
        }

        const csvText = await response.text();
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
              
              const businessDays: { date: number, label: string }[] = [];
              for (let d = 1; d <= daysInMonth; d++) {
                const date = new Date(year, month, d);
                const dayOfWeek = date.getDay(); // 0 (Sun) to 6 (Sat)
                
                const dayStr = d.toString().padStart(2, '0');
                const monthStr = (month + 1).toString().padStart(2, '0');
                const dateKey = `${dayStr}/${monthStr}`;

                const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                const isHoliday = holidays2026.includes(dateKey);

                if (!isWeekend && !isHoliday) {
                  businessDays.push({ date: d, label: dateKey });
                }
              }

              // 3. Extract data following the spreadsheet sequence (DIA 01, DIA 02...)
              // but mapping it to business calendar labels and filtering by current date
              const processedData: DayData[] = businessDays
                .filter(bDay => bDay.date <= now.getDate()) // ONLY show days up to today
                .map((bDay, index) => {
                  const opIndex = index + 1; // Operation index (1 to 22 approx)
                  const searchLabel = `DIA ${opIndex.toString().padStart(2, '0')}`;
                  
                  const dayRow = rows.find(r => r[0]?.toUpperCase().includes(searchLabel));
                  
                  // Lucro (Coluna B)
                  const profit = parseValue(dayRow && dayRow[1] ? dayRow[1] : "");

                  // Operações (Coluna E)
                  const ops = parseValue(dayRow && dayRow[4] ? dayRow[4] : "");
                  
                  return {
                    day: opIndex,
                    displayDay: bDay.date,
                    displayLabel: bDay.label,
                    risk: foundRisk,
                    profit: profit,
                    withdrawals: 0, // No longer per-day from table
                    operations: ops,
                    hits: profit > 0 ? 1 : 0,
                    errors: profit < 0 ? 1 : 0,
                  };
                });

              setInitialBalance(foundInitialBalance);
              setTotalWithdrawals(foundTotalWithdrawals);
              setData(processedData);
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
      } catch (err: any) {
        console.error("Final catch hook:", err);
        setError(err instanceof Error ? err.message : "Falha na conexão.");
        
        // Always ensure loading is false
        setLoading(false);
        
        // Fallback mock data if fetch truly fails
        const mockData = Array.from({ length: 22 }, (_, i) => ({
          day: i + 1,
          risk: i < 12 ? 100 : 0,
          profit: i < 12 ? (Math.random() > 0.4 ? (Math.random() * 250) : -(Math.random() * 120)) : 0,
          operations: i < 12 ? Math.floor(Math.random() * 5) + 1 : 0,
          hits: i < 12 ? Math.floor(Math.random() * 3) : 0,
          errors: i < 12 ? Math.floor(Math.random() * 2) : 0,
        }));
        setData(mockData);
        setInitialBalance(10000);
      }
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
          <div className="mb-8">
            <h1 className="text-3xl font-bold tracking-[0.3em] uppercase text-white mb-2">Central FIG</h1>
            <div className="h-0.5 w-12 bg-orange-500 mx-auto opacity-50"></div>
          </div>

          <div className="mb-10 inline-flex items-center justify-center w-12 h-12 rounded-full bg-orange-500/10 border border-orange-500/20 text-orange-500">
            <Lock size={24} />
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

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#060606]">
        <motion.div 
          animate={{ scale: [1, 1.1, 1], opacity: [0.5, 1, 0.5] }}
          transition={{ repeat: Infinity, duration: 1.5 }}
          className="text-orange-500 font-medium z-50"
        >
          Carregando Dashboard...
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
        <div className="flex items-center justify-between z-20 relative">
          <div className="flex flex-col">
            <h1 className="text-2xl font-bold tracking-[0.2em] uppercase text-white">Central FIG</h1>
            <div className="h-0.5 w-8 bg-orange-500 opacity-50"></div>
          </div>
          
          <button 
            onClick={handleLogout}
            className="flex items-center gap-2 px-4 py-2 bg-white/[0.03] border border-white/5 rounded-md text-[10px] uppercase tracking-widest font-bold text-gray-500 hover:text-rose-500 hover:bg-rose-500/5 hover:border-rose-500/20 transition-all group"
          >
            <LogOut size={14} className="group-hover:scale-110 transition-transform" />
            Sair do Painel
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
                <div className="flex items-baseline justify-center gap-4">
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

            <div className="h-[240px] mt-12 z-10 w-full">
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
                  <p className="text-[10px] text-orange-500 uppercase font-bold tracking-widest mb-1">Disponível para Saque</p>
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

          <div className="overflow-x-auto">
            <table className="w-full text-left border-separate border-spacing-y-3">
              <thead>
                <tr className="text-gray-500 text-xs uppercase tracking-wider">
                  <th className="px-6 py-2 font-medium">Data / Operação</th>
                  <th className="px-6 py-2 font-medium">Lucro/Prejuízo</th>
                  <th className="px-6 py-2 font-medium">Desempenho</th>
                  <th className="px-6 py-2 font-medium">Operações</th>
                </tr>
              </thead>
              <tbody>
                {data.map((day) => (
                  <DayRow key={day.day} data={day} />
                ))}
              </tbody>
            </table>
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

  let barColorClass = "bg-orange-500/10";
  let barFullColor = "bg-orange-500/60";
  
  if (data.profit > 10) {
    barColorClass = "bg-emerald-500/10";
    barFullColor = "bg-emerald-500/60";
  } else if (data.profit < 0) {
    barColorClass = "bg-rose-500/10";
    barFullColor = "bg-rose-500/60";
  }

  return (
    <motion.tr 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="group bg-white/[0.01] border-b border-white/[0.05] hover:bg-white/[0.03] transition-all"
    >
      <td className="px-8 py-6">
        <span className="flex items-center gap-4">
          <span className="text-xs font-mono font-bold text-gray-600 group-hover:text-orange-500 transition-colors tracking-tighter">
            {data.displayLabel || data.day.toString().padStart(2, '0')}
          </span>
          <span className="text-sm font-medium tracking-wide uppercase">{data.day}ª Op.</span>
        </span>
      </td>
      <td className="px-8 py-6">
        <div className="flex flex-col">
          <span className={cn(
            "text-sm font-medium tracking-tight",
            isPositive ? "text-emerald-400" : isLoss ? "text-rose-400" : "text-orange-400"
          )}>
            {data.profit > 0 ? "+" : ""}{formatCurrency(data.profit)}
          </span>
          <span className="text-[10px] text-gray-600 uppercase font-bold tracking-widest">Lucro</span>
        </div>
      </td>
      <td className="px-8 py-6 min-w-[180px]">
        <div className="flex items-center gap-4">
          <div className={cn("flex-1 h-[2px] bg-white/5")}>
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: isNeutral ? '20%' : '100%' }}
              className={cn("h-full transition-all duration-1000", barFullColor)}
            />
          </div>
          <span className={cn(
            "text-[9px] font-bold uppercase tracking-[0.2em]",
            isPositive ? "text-emerald-500" : isLoss ? "text-rose-500" : "text-orange-500"
          )}>
            {isPositive ? "Win" : isLoss ? "Loss" : "Flat"}
          </span>
        </div>
      </td>
      <td className="px-8 py-6">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 focus:outline-none">
            {Array.from({ length: 4 }).map((_, i) => {
              // Logic: 
              // < 10: green, 4 bars
              // 10-20: yellow, 3 bars
              // 20-40: orange, 2 bars
              // > 40: red, 1 bar
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
          <span className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">{data.operations} op.</span>
        </div>
      </td>
    </motion.tr>
  );
}

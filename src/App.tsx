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
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

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

const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", 
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

// Brazilian National Holidays 2026 (Format: "DD/MM")
const BR_HOLIDAYS_2026 = [
  "01/01", "16/02", "17/02", "03/04", "21/04", "01/05", 
  "04/06", "07/09", "12/10", "02/11", "15/11", "20/11", "25/12"
];

// Mapping of Month Index to Spreadsheet GID (if applicable)
const MONTH_GIDS: Record<number, string> = {
  0: "",         // Jan
  1: "",         // Feb
  2: "",         // Mar
  3: "0",        // Apr
  4: "804947437", // May
  5: "1824223648", // Jun
  6: "742104149", // Jul
  7: "483152687", // Aug
  8: "863872661", // Sep
  9: "148047064", // Oct
  10: "1158204145", // Nov
  11: "484266407", // Dec
};

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
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth());

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
        if (isInitial) {
          setLoading(true);
          setData([]); // Limpa os dados anteriores para garantir que o usuário veja a transição
        }
        // Clear previous data on month change to avoid stale state
        setError(null);
        
        const envUrl = (import.meta as any).env.VITE_SPREADSHEET_URL;
        let baseUsedUrl = envUrl || DEFAULT_SPREADSHEET_URL;
        
        // Clean URL whitespace
        baseUsedUrl = baseUsedUrl.trim();

        // Target specific tab (GID) if defined for the selected month
        const targetGid = MONTH_GIDS[selectedMonth];
        
        let exportUrl = baseUsedUrl;
        const spreadSheetId = baseUsedUrl.match(/\/d\/([a-zA-Z0-9-_]+)/)?.[1];
        
        if (spreadSheetId) {
          // Construct a cleaner export URL which often bypasses certain "pub" blocks
          exportUrl = `https://docs.google.com/spreadsheets/d/${spreadSheetId}/export?format=csv${targetGid ? `&gid=${targetGid}` : ''}`;
        }

        if (targetGid && !baseUsedUrl.includes('gid=')) {
          baseUsedUrl += (baseUsedUrl.includes('?') ? '&' : '?') + `gid=${targetGid}`;
        }

        const usedUrl = baseUsedUrl.includes('?') 
          ? `${baseUsedUrl}&_cb=${Date.now()}` 
          : `${baseUsedUrl}?_cb=${Date.now()}`;
        
        let csvText = '';

        const tryFetch = async (url: string, timeout = 25000, retries = 1) => {
          for (let i = 0; i <= retries; i++) {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), timeout);
            try {
              const res = await fetch(url, { 
                signal: controller.signal,
                headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
              });
              clearTimeout(id);
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const text = await res.text();
              if (!text || text.length < 5) throw new Error("Vazio");
              return text;
            } catch (err: any) {
              clearTimeout(id);
              const isNetwork = err.message === 'Failed to fetch' || err.name === 'TypeError';
              const isTimeout = err.name === 'AbortError' || err.message === 'Timeout';
              
              if (i === retries) {
                if (isNetwork) throw new Error("NetworkError");
                if (isTimeout) throw new Error("Timeout");
                throw err;
              }
              await new Promise(r => setTimeout(r, 800));
            }
          }
          throw new Error("Falha total");
        };

        try {
          // Attempt 1: Direct Export Fetch
          try {
            csvText = await tryFetch(exportUrl, 15000);
          } catch (e: any) {
            // Attempt 2: Direct Published Fetch
            csvText = await tryFetch(usedUrl, 15000);
          }
        } catch (err1) {
          console.warn("Direct attempts failed, trying proxies...", err1);
          setError("Conexão instável: Tentando pular bloqueio de rede...");
          
          // Cascading Proxies
          try {
            // Proxy 1: AllOrigins (via fetch wrapper)
            const p1 = `https://api.allorigins.win/get?url=${encodeURIComponent(exportUrl)}&_cb=${Date.now()}`;
            const r1 = await tryFetch(p1, 20000);
            const data1 = JSON.parse(r1);
            if (data1.contents) csvText = data1.contents;
            else throw new Error("P1 Empty");
          } catch (errProxy1) {
            console.warn("Proxy 1 failed:", errProxy1);
            try {
              // Proxy 2: CorsProxy.io
              const p2 = `https://corsproxy.io/?${encodeURIComponent(exportUrl)}`;
              csvText = await tryFetch(p2, 20000);
            } catch (errProxy2) {
              console.warn("Proxy 2 failed:", errProxy2);
              try {
                // Proxy 3: Backup Public Gateway
                const p3 = `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(exportUrl)}`;
                csvText = await tryFetch(p3, 20000);
              } catch (errProxy3: any) {
                console.error("All high-resilience paths failed:", errProxy3);
                
                const cached = localStorage.getItem('last_valid_data');
                if (cached && cached !== '[]') {
                  setData(JSON.parse(cached));
                  setLoading(false);
                  setError("Aviso: Bloqueio de rede detectado. Exibindo última versão salva.");
                  return;
                }

                throw new Error("Bloqueio de Rede: Sua conexão está impedindo o acesso ao Google. Tente usar outra rede ou 4G.");
              }
            }
          }
        }
        
        if (csvText) {
          processCsv(csvText);
        }
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
              const rows = (results.data as string[][]) || [];
              
              // Helper to parse numbers from Brazilian/International formats correctly
              const parseValue = (val: string) => {
                if (!val) return 0;
                // Clean all except digits, dots, commas and minus sign
                const cleaned = val.toString().trim().replace(/[^\d.,-]/g, '');
                if (!cleaned) return 0;
                
                // Identify which decimal separator is being used
                // If there's a comma and it's after the last dot, or if there's only a comma
                const lastComma = cleaned.lastIndexOf(',');
                const lastDot = cleaned.lastIndexOf('.');
                
                if (lastComma > lastDot) {
                  // Brazilian format: Comma is decimal
                  return parseFloat(cleaned.replace(/\./g, '').replace(',', '.')) || 0;
                } else {
                  // International format: Dot is decimal
                  return parseFloat(cleaned.replace(/,/g, '')) || 0;
                }
              };

              // 1. Find Initial Balance, Risk and Total Withdrawals with safe defaults
              let foundInitialBalance = 0;
              const balanceRow = rows.find(r => r[0]?.toUpperCase().includes("APORTE INICIAL"));
              if (balanceRow && balanceRow[1]) {
                foundInitialBalance = parseValue(balanceRow[1]);
              }

              let foundRisk = 0;
              const riskRow = rows.find(r => r[0]?.toUpperCase().includes("RISCO DIARIO"));
              if (riskRow && riskRow[1]) {
                foundRisk = parseValue(riskRow[1]);
              }

              // Sum withdrawals
              let foundTotalWithdrawals = 0;
              const withdrawalRow = rows.find(r => r[0]?.toUpperCase().includes("SAQUES REALIZADOS"));
              if (withdrawalRow) {
                for (let i = 1; i < withdrawalRow.length; i++) {
                  foundTotalWithdrawals += parseValue(withdrawalRow[i]);
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
              
              if (foundUsers.length > 0) {
                setAllowedUsers(foundUsers);
              }

              // 2. Logic for Business Days
              const year = new Date().getFullYear();
              const daysInMonth = new Date(year, selectedMonth + 1, 0).getDate();

              const monthCalendarDays: { date: number, label: string, isNonWorkingDay: boolean }[] = [];
              for (let d = 1; d <= daysInMonth; d++) {
                const date = new Date(year, selectedMonth, d);
                const dayOfWeek = date.getDay(); // 0 (Sun) to 6 (Sat)
                
                const dayStr = d.toString().padStart(2, '0');
                const monthStr = (selectedMonth + 1).toString().padStart(2, '0');
                const dateKey = `${dayStr}/${monthStr}`;

                const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                const isHoliday = BR_HOLIDAYS_2026.includes(dateKey);

                monthCalendarDays.push({ 
                  date: d, 
                  label: dateKey,
                  isNonWorkingDay: isWeekend || isHoliday
                });
              }

              // 3. Extract data for the full month (don't filter anymore)
              const processedData: DayData[] = monthCalendarDays.map((calDay) => {
                const searchLabel = `DIA ${calDay.date.toString().padStart(2, '0')}`;
                
                const dayRow = rows.find(r => r[0]?.toUpperCase().includes(searchLabel));
                
                // Profit (Coluna B)
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
              
              // Filter out future days
              const now = new Date();
              const currentMonthIndex = now.getMonth();
              const currentDayNumber = now.getDate();

              let filteredData = [...processedData];
              if (selectedMonth === currentMonthIndex) {
                // For current month, only show days <= today
                filteredData = processedData.filter(d => d.day <= currentDayNumber);
              } else if (selectedMonth > currentMonthIndex) {
                // For future months, hide everything
                filteredData = [];
              }
              
              setData(filteredData);
              
              const updatedTime = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
              setLastUpdated(updatedTime);
              
              // Persist filtered data in case of future connection failure
              localStorage.setItem('last_valid_data', JSON.stringify(filteredData));
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
  }, [selectedMonth]);

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

    const totalPositiveProfit = data.reduce((acc, curr) => acc + curr.profit, 0); // Soma todos os resultados (Net Profit)
    const taxes = totalPositiveProfit > 0 ? totalPositiveProfit * 0.19 : 0; // Taxa apenas sobre o lucro real líquido
    const consolidatedValue = initialBalance + totals.totalProfit - totalWithdrawals;
    const availableBalance = consolidatedValue - taxes;

    const dailyRisk = data[0]?.risk || 0;

    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonthIdx = today.getMonth();
    const currentDay = today.getDate();

    // Calculate TOTAL working days in the selected month (full month)
    const daysInMonth = new Date(currentYear, selectedMonth + 1, 0).getDate();
    let totalWorkingDaysInFullMonth = 0;
    
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(currentYear, selectedMonth, d);
      const dayOfWeek = date.getDay();
      const dateKey = `${d.toString().padStart(2, '0')}/${(selectedMonth + 1).toString().padStart(2, '0')}`;
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const isHoliday = BR_HOLIDAYS_2026.includes(dateKey);
      if (!isWeekend && !isHoliday) {
        totalWorkingDaysInFullMonth++;
      }
    }

    // Calculate days passed (working days strictly <= today if current month)
    let daysPassed = 0;
    if (selectedMonth < currentMonthIdx) {
      daysPassed = totalWorkingDaysInFullMonth;
    } else if (selectedMonth === currentMonthIdx) {
      // Re-calculate working days up to today
      for (let d = 1; d <= currentDay; d++) {
        const date = new Date(currentYear, selectedMonth, d);
        const dayOfWeek = date.getDay();
        const dateKey = `${d.toString().padStart(2, '0')}/${(selectedMonth + 1).toString().padStart(2, '0')}`;
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        const isHoliday = BR_HOLIDAYS_2026.includes(dateKey);
        if (!isWeekend && !isHoliday) {
          daysPassed++;
        }
      }
    } else {
      daysPassed = 0;
    }
    
    const daysRemaining = totalWorkingDaysInFullMonth - daysPassed;
    const progressPercent = totalWorkingDaysInFullMonth > 0 ? (daysPassed / totalWorkingDaysInFullMonth) * 100 : 0;

    return {
      initialBalance,
      ...totals,
      taxes,
      availableBalance,
      winRate,
      dailyRisk,
      progress: {
        total: totalWorkingDaysInFullMonth,
        passed: daysPassed,
        remaining: daysRemaining,
        percent: progressPercent
      }
    };
  }, [data, initialBalance, selectedMonth]);

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

  const handlePrint = () => {
    const doc = new jsPDF({
      orientation: 'p',
      unit: 'mm',
      format: 'a4',
      putOnlyUsedFonts: true
    });

    const monthName = MONTHS[selectedMonth];
    const year = new Date().getFullYear();

    // Configurações de cores e fontes
    const primaryColor: [number, number, number] = [249, 115, 22]; // Orange-500
    const secondaryColor: [number, number, number] = [60, 60, 60];

    // Título - Compactar topo
    doc.setFontSize(18);
    doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
    doc.text('CENTRAL FIG', 14, 15);
    
    doc.setFontSize(14);
    doc.text(`Relatório de Performance - ${monthName} ${year}`, 14, 23);
    
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, 14, 28);

    // Linha divisória
    doc.setDrawColor(240);
    doc.line(14, 30, 196, 30);

    // Resumo Financeiro
    doc.setFontSize(10);
    doc.setTextColor(0);
    doc.setFont("helvetica", "bold");
    doc.text("Resumo Financeiro", 14, 37);
    
    const summaryRows = [
      ["Aporte Inicial", formatCurrency(summary.initialBalance)],
      ["Lucro Bruto", formatCurrency(summary.totalProfit)],
      ["Saques Realizados", formatCurrency(summary.totalWithdrawals)],
      ["Taxas Acumuladas (19%)", formatCurrency(summary.taxes)],
      ["Valor Livre (Disponível)", formatCurrency(summary.availableBalance)],
      ["Taxa de Acerto", `${summary.winRate.toFixed(1)}%`],
      ["Saldo Consolidado", formatCurrency(currentBalance)]
    ];

    autoTable(doc, {
      startY: 40,
      head: [["Métrica", "Valor"]],
      body: summaryRows,
      theme: 'grid',
      styles: { fontSize: 7.5, cellPadding: 1, font: 'helvetica' },
      headStyles: { fillColor: primaryColor, textColor: [255, 255, 255], fontStyle: 'bold' },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 60 },
        1: { halign: 'right' }
      },
      margin: { left: 14, right: 14 }
    });

    // Espaçamento mínimo
    const finalY = (doc as any).lastAutoTable.finalY + 6;

    // Detalhamento Diário
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("Detalhamento Diário", 14, finalY);

    const tableData = data.map(day => [
      day.displayLabel || day.day.toString().padStart(2, '0'),
      formatCurrency(day.profit),
      day.isNonWorkingDay ? "OFF" : (day.profit > 0 ? "WIN" : day.profit < 0 ? "LOSS" : "FLAT"),
      day.operations
    ]);

    autoTable(doc, {
      startY: finalY + 3,
      head: [["Data", "Lucro/Prejuízo", "Res.", "Op."]],
      body: tableData,
      theme: 'striped',
      styles: { fontSize: 7, cellPadding: 0.8, font: 'helvetica' },
      headStyles: { fillColor: [80, 80, 80], textColor: [255, 255, 255] },
      columnStyles: {
        1: { halign: 'right' },
        2: { halign: 'center' },
        3: { halign: 'center' }
      },
      margin: { left: 14, right: 14, bottom: 12 }
    });

    // Rodapé fixo na única página
    doc.setFontSize(7);
    doc.setTextColor(180);
    doc.setFont("helvetica", "normal");
    doc.text('Relatório Confidencial - Central FIG Dashboard', doc.internal.pageSize.width / 2, doc.internal.pageSize.height - 8, { align: 'center' });

    // Salvar o PDF
    doc.save(`Relatorio_CentralFIG_${monthName}_${year}.pdf`);
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
      <main 
        id="dashboard-content"
        className="relative z-10 max-w-[1400px] mx-auto p-6 md:p-12 space-y-12 print:p-0 print:space-y-4"
      >
        {/* Header with Branding & Logout */}
        <div id="dashboard-header" className="flex items-center justify-center md:justify-between z-20 relative print:hidden">
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
            title="Sair do Painel"
            className="absolute right-0 md:relative flex items-center p-2.5 bg-white/5 border border-white/10 rounded-full text-gray-500 hover:text-rose-500 transition-all group"
          >
            <LogOut size={15} className="group-hover:scale-110 transition-transform" />
          </button>
        </div>

        {error && (
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 p-5 bg-orange-500/10 border border-orange-500/20 rounded-md text-orange-200 text-sm print:hidden">
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

        {/* Month Navigation */}
        <section className="print:hidden">
          <div className="glass-card p-2">
            <div className="flex items-center md:justify-center gap-1 overflow-x-auto no-scrollbar py-1 px-1">
              {MONTHS.map((month, index) => {
                const isSelected = selectedMonth === index;
                
                return (
                  <button
                    key={month}
                    onClick={() => setSelectedMonth(index)}
                    className={cn(
                      "px-4 py-2 rounded-md text-[9px] uppercase font-bold tracking-widest transition-all shrink-0 whitespace-nowrap border",
                      isSelected 
                        ? "border-orange-500/40 text-orange-500 shadow-[0_0_15px_rgba(249,115,22,0.1)]" 
                        : "border-transparent text-gray-500 hover:text-white"
                    )}
                  >
                    {month}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {/* Hero Section: Stats + Charts */}
        <div id="stats-overview" className="grid grid-cols-1 lg:grid-cols-3 gap-10 print:grid-cols-1">
          {/* Main Balance Card */}
          <section id="balance-card" className="lg:col-span-2 glass-card p-10 flex flex-col justify-between overflow-hidden relative group print:bg-white print:text-black print:p-6 print:border-black">
            <div className="absolute -top-32 -right-32 w-80 h-80 bg-orange-600/5 blur-[120px] pointer-events-none group-hover:bg-orange-600/10 transition-all duration-1000 print:hidden"></div>
            
            <div className="flex flex-col items-center justify-center z-10 text-center">
              <div>
                <p className="text-gray-500 text-xs font-semibold uppercase tracking-[0.2em] mb-4 print:text-black print:mb-2">Saldo Consolidado</p>
                <div className="flex flex-col items-center justify-center gap-3">
                  <h2 className="text-5xl md:text-6xl font-light tracking-tight print:text-4xl">{formatCurrency(currentBalance)}</h2>
                  <span className={cn(
                    "text-xs font-medium px-2.5 py-1 tracking-wider uppercase print:text-black",
                    summary.totalProfit >= 0 ? "text-emerald-400 bg-emerald-400/5 border border-emerald-400/20 print:border-black" : "text-rose-400 bg-rose-400/5 border border-rose-400/20 print:border-black"
                  )}>
                    {summary.totalProfit >= 0 ? "+" : ""}
                    {(summary.initialBalance !== 0 ? (summary.totalProfit / summary.initialBalance) * 100 : 0).toFixed(2)}%
                  </span>
                </div>
              </div>
            </div>

            <div className="h-[160px] md:h-[240px] mt-12 z-10 w-full print:hidden">
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

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 mt-12 z-10 border-t border-white/5 pt-8 print:mt-4 print:pt-4 print:border-black print:grid-cols-2">
              <StatItem label="Aporte Inicial" value={formatCurrency(summary.initialBalance)} />
              <StatItem label="Lucro Bruto" value={formatCurrency(summary.totalProfit)} color={summary.totalProfit >= 0 ? "text-emerald-400 print:text-black" : "text-rose-400 print:text-black"} />
              <StatItem label="Taxa de Acerto" value={`${summary.winRate.toFixed(1)}%`} />
              <StatItem label="Risco Diário" value={formatCurrency(summary.dailyRisk)} />
            </div>
          </section>

          {/* Financial Breakdown Section */}
          <section className="glass-card p-10 flex flex-col justify-between print:bg-white print:text-black print:p-6 print:border-black">
            <div className="w-full space-y-4">
              <div className="mb-6 p-4 bg-white/[0.01] border border-white/[0.03] rounded-md text-center print:bg-transparent print:border-black">
                <p className="text-[9px] text-gray-600 uppercase font-bold tracking-[0.25em] mb-1 print:text-black">Volume Total Acumulado</p>
                <p className="text-lg font-light text-gray-400 print:text-black">{formatCurrency(summary.initialBalance + summary.totalProfit)}</p>
              </div>

              <OperationRow label="Acertos" value={summary.totalHits} unit="dias" color="bg-emerald-500" />
              <OperationRow label="Erros" value={summary.totalErrors} unit="dias" color="bg-rose-500" />
              <div className="pt-4 border-t border-white/5 space-y-4 print:border-black flex flex-col items-center">
                {/* Monthly Progress Tracker */}
                <div className="w-full p-4 bg-white/[0.02] border border-white/5 rounded-md space-y-3 print:hidden">
                  <div className="flex justify-between items-end">
                    <div className="flex flex-col items-start">
                      <span className="text-[8px] uppercase tracking-[0.25em] text-gray-600 font-bold mb-1">Pregresso do Mês</span>
                      <span className="text-sm font-light text-gray-300">
                        {summary.progress.passed} <span className="text-[10px] text-gray-600 uppercase">Dias Concluídos</span>
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-light text-orange-500">
                        {summary.progress.remaining} <span className="text-[10px] text-gray-600 uppercase">Restantes</span>
                      </span>
                    </div>
                  </div>
                  
                  <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${summary.progress.percent}%` }}
                      transition={{ duration: 1, ease: "easeOut" }}
                      className="h-full bg-orange-500 shadow-[0_0_10px_rgba(249,115,22,0.3)]"
                    />
                  </div>

                  <div className="flex justify-between text-[8px] uppercase tracking-widest text-gray-700 font-bold">
                    <span>Início</span>
                    <span>{summary.progress.total} Dias de Operação</span>
                    <span>Meta</span>
                  </div>
                </div>

                <div className="w-full space-y-4">
                  <OperationRow label="Saques" value={summary.totalWithdrawals} isCurrency color="bg-blue-500" />
                  <OperationRow label="Taxas (19%)" value={summary.taxes} isCurrency color="bg-orange-500" />
                </div>
                
                <div className="w-full mt-4 p-5 bg-orange-500/10 border border-orange-500/20 rounded-md text-center print:bg-gray-50 print:border-black">
                  <p className="text-[10px] text-orange-500 uppercase font-bold tracking-widest mb-1 print:text-black">VALOR LIVRE DE TAXAS</p>
                  <p className="text-2xl font-light text-white print:text-black">{formatCurrency(summary.availableBalance)}</p>
                </div>
              </div>
            </div>
          </section>
        </div>

        <section id="performance-table" className="glass-card p-10 print:bg-white print:p-0 print:border-none">
          <div className="flex flex-col md:flex-row items-center justify-between mb-12 print:mb-6">
            <div className="text-center md:text-left">
              <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500 mb-2 print:text-black">
                Registro - {MONTHS[selectedMonth]} {new Date().getFullYear()}
              </h3>
              <p className="text-xl font-light print:text-black print:text-sm">Controle de Performance</p>
            </div>
            
            <button
              onClick={handlePrint}
              className="mt-6 md:mt-0 flex items-center gap-2 px-6 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-md transition-all text-[10px] uppercase font-bold tracking-widest print:hidden cursor-pointer"
            >
              <LogIn size={14} className="rotate-90" />
              Baixar Relatório PDF
            </button>
          </div>

          <div className="w-full">
            {/* Table Header - Desktop Only */}
            <div className="hidden md:grid md:grid-cols-4 text-gray-500 text-[10px] uppercase tracking-widest font-bold px-6 mb-4 print:grid print:grid-cols-4 print:text-black print:px-2">
              <div className="px-2">Data / Operação</div>
              <div className="px-2">Lucro/Prejuízo</div>
              <div className="px-2">Desempenho</div>
              <div className="px-2">Operações</div>
            </div>

            <div className="space-y-3 print:space-y-1">
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
      <p className="text-gray-500 text-[10px] font-semibold uppercase tracking-[0.2em] mb-2 print:text-black print:text-[8px]">{label}</p>
      <p className={cn("text-xl font-light tracking-tight print:text-black print:text-xs", color)}>{value}</p>
    </div>
  );
}

function OperationRow({ label, value, color, unit, isCurrency }: { label: string, value: number, color: string, unit?: string, isCurrency?: boolean }) {
  return (
    <div className="flex items-center justify-between p-4 bg-white/[0.02] border border-white/5 rounded-md transition-colors hover:bg-white/[0.04] print:bg-transparent print:border-black print:p-2">
      <div className="flex items-center gap-4">
        <div className={cn("w-2 h-2 rounded-full print:border print:border-black", color)}></div>
        <span className="text-xs uppercase tracking-widest font-medium text-gray-400 print:text-black print:text-[8px]">{label}</span>
      </div>
      <span className="text-lg font-light print:text-black print:text-xs">
        {isCurrency ? formatCurrency(value) : `${value} ${unit || ''}`}
      </span>
    </div>
  );
}

const DayRow: React.FC<{ data: DayData }> = ({ data }) => {
  const isPositive = data.profit > 0;
  const isLoss = data.profit < 0;
  const isNeutral = data.profit === 0;
  const isInactive = (data.profit === 0 && data.operations === 0) || data.isNonWorkingDay;

  const barColor = data.isNonWorkingDay 
    ? "bg-rose-500/20" 
    : isNeutral 
      ? "bg-white/10" 
      : (data.profit > 10 ? "bg-emerald-500/60" : (data.profit < 0 ? "bg-rose-500/60" : "bg-orange-500/60"));
  
  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.005, backgroundColor: "rgba(255, 255, 255, 0.03)" }}
      className={cn(
        "group border transition-all p-4 md:p-6 rounded-md md:grid md:grid-cols-4 flex flex-col gap-4 md:gap-8 items-center md:items-stretch print:grid print:grid-cols-4 print:bg-white print:text-black print:p-2 print:border-black print:gap-2",
        data.isNonWorkingDay 
          ? "bg-rose-900/5 border-rose-900/20 print:border-black" 
          : isNeutral
            ? "bg-white/5 border-white/5"
            : "bg-white/[0.01] border-white/[0.05] hover:border-white/10 print:border-black"
      )}
    >
      {/* Col 1: Date/Op & Profit (Mobile side-by-side) */}
      <div className="flex items-center gap-4 w-full md:w-auto justify-between md:justify-start print:justify-start">
        <div className="flex items-center gap-4">
          <span className={cn(
            "text-xs font-mono font-bold transition-colors tracking-tighter print:text-[8px]",
            data.isNonWorkingDay ? "text-rose-500" : isNeutral ? "text-gray-600" : "text-gray-400 group-hover:text-orange-500 print:text-black"
          )}>
            {data.displayLabel || data.day.toString().padStart(2, '0')}
          </span>
          <span className={cn(
            "text-sm font-medium tracking-wide uppercase print:text-[8px]",
            isNeutral ? "text-gray-600" : "text-white"
          )}>Dia {data.day}</span>
        </div>
        
        {/* Profit on the right side for Mobile Only */}
        <div className="md:hidden flex flex-col items-end print:hidden">
          <span className={cn(
            "text-sm font-medium tracking-tight",
            isNeutral ? "text-gray-600" : (isPositive ? "text-emerald-400" : isLoss ? "text-rose-400" : "text-orange-400")
          )}>
            {data.profit > 0 ? "+" : ""}{formatCurrency(data.profit)}
          </span>
          <span className="text-[9px] text-gray-600 uppercase font-bold tracking-widest leading-none">Lucro</span>
        </div>
      </div>

      {/* Col 2: Profit (Desktop Only) */}
      <div className="hidden md:flex flex-col items-center md:items-start w-full md:w-auto print:flex print:flex-col print:items-start">
        <span className={cn(
          "text-sm font-medium tracking-tight print:text-[8px]",
          isNeutral ? "text-gray-600" : (isPositive ? "text-emerald-400 print:text-black" : isLoss ? "text-rose-400 print:text-black" : "text-orange-400 print:text-black")
        )}>
          {data.profit > 0 ? "+" : ""}{formatCurrency(data.profit)}
        </span>
        <span className="text-[10px] text-gray-600 uppercase font-bold tracking-widest print:text-[6px]">Lucro</span>
      </div>

      {/* Col 3: Performance Bar */}
      <div className="flex items-center gap-4 min-w-0 w-full md:w-auto px-0 md:px-4 print:px-0">
        <div className="flex-1 h-[2px] bg-white/5 relative print:bg-gray-100">
          <motion.div 
            initial={{ width: 0 }}
            animate={{ width: isNeutral ? '20%' : '100%' }}
            className={cn("h-full transition-all duration-1000 print:bg-black", barColor)}
          />
        </div>
        <span className={cn(
          "text-[9px] font-bold uppercase tracking-[0.2em] shrink-0 print:text-[6px]",
          data.isNonWorkingDay ? "text-rose-500/50" : isNeutral 
            ? "text-gray-600 print:text-gray-400" 
            : (isPositive ? "text-emerald-500 print:text-black" : isLoss ? "text-rose-500 print:text-black" : "text-orange-500 print:text-black")
        )}>
          {data.isNonWorkingDay ? "OFF" : isNeutral ? "ZERADO" : (isPositive ? "Win" : isLoss ? "Loss" : "Flat")}
        </span>
      </div>

      {/* Col 4: Operations Bars */}
      <div className="flex items-center justify-between md:justify-start gap-4 w-full md:w-auto md:pl-8 print:pl-0">
        <div className="flex items-center gap-1.5 shrink-0 print:hidden">
          {Array.from({ length: 4 }).map((_, i) => {
            let activeBars = 0;
            let currentBarColor = "bg-white/5";
            
            if (isNeutral || data.isNonWorkingDay) {
              activeBars = 0;
              currentBarColor = "bg-white/5";
            } else if (data.operations < 10) {
              activeBars = 4;
              currentBarColor = "bg-emerald-500/60";
            } else if (data.operations >= 10 && data.operations < 20) {
              activeBars = 3;
              currentBarColor = "bg-yellow-500/60";
            } else if (data.operations >= 20 && data.operations < 40) {
              activeBars = 2;
              currentBarColor = "bg-orange-500/60";
            } else {
              activeBars = 1;
              currentBarColor = "bg-rose-500/60";
            }

            const isActive = i < activeBars;

            return (
              <div key={i} className={cn(
                "w-1 h-3 rounded-[1px] transition-all duration-500",
                isActive ? currentBarColor : "bg-white/[0.05]"
              )} />
            );
          })}
        </div>
        <span className={cn(
          "text-[10px] font-bold uppercase tracking-widest shrink-0 print:text-[6px]",
          isNeutral ? "text-gray-600" : "text-gray-500"
        )}>{data.operations} op.</span>
      </div>
    </motion.div>
  );
};

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

# ===== DATA =====
PRICING = {"Flash":{"in":0.14,"out":0.28,"cache":0.03},"Plus":{"in":0.95,"out":4.00,"cache":0.15},"Max":{"in":5.00,"out":30.00,"cache":0.50}}
MULT = {"Flash":0.33,"Plus":1.0,"Max":5.0}
CREDIT=1000; INP=7.0/8.0; OUT=1.0/8.0; CH=0.60
tpc = {m: CREDIT/mult for m,mult in MULT.items()}

def cpc(model, cache_hit):
    p = PRICING[model]; t = tpc[model]
    ic = (cache_hit*p["cache"]+(1-cache_hit)*p["in"])*t*INP/1e6
    oc = p["out"]*t*OUT/1e6
    return ic+oc

PK = {"veh":0.01,"h30":0.02,"h90":0.05,"h1y":0.15,"hun":0.50,"adf":0.25,"exp":0.05,"dsh":0.10,"tel":0.50,"alr":0.20,"api":0.30,"sups":0.30,"supp":0.50,"supd":3.00,"wlb":0.15,"sso":0.15,"ded":3.00,"sea":0.10,"ftu":2.00,"sla":0.75}

def hist_cost(h):
    return {"30d":0.02,"90d":0.05,"1yr":0.15,"unlim":0.50}[h]

def t_perks(t):
    c = (t["v"]*0.01) if t["v"]>0 else 1.0
    c += hist_cost(t["h"])
    c += sum([0.25*t["ad"], 0.05*t["ex"], 0.10*t["db"], 0.50*t["tl"], 0.20*t["al"], 0.30*t["api"]])
    su = t["su"]
    c += {"basic":0,"std":0.30,"priority":0.50,"dedicated":3.00}[su]
    c += sum([0.15*t["wl"], 0.15*t["sso"], 3.00*t["ded"], 2.00*t["ft"], 0.75*t["sla"]])
    c += (t["se"]-1)*0.10
    return c

T = [
    {"n":"Free","p":0,"c":50,"v":1,"h":"30d","ad":0,"ex":0,"db":0,"tl":0,"al":0,"api":0,"su":"basic","wl":0,"sso":0,"ded":0,"se":1,"ft":0,"sla":0,"u":{"Flash":1.0}},
    {"n":"Free+","p":0,"c":150,"v":2,"h":"90d","ad":0,"ex":0,"db":0,"tl":0,"al":0,"api":0,"su":"basic","wl":0,"sso":0,"ded":0,"se":1,"ft":0,"sla":0,"u":{"Flash":0.9,"Plus":0.1}},
    {"n":"Starter","p":3,"c":500,"v":3,"h":"90d","ad":1,"ex":1,"db":0,"tl":0,"al":0,"api":0,"su":"basic","wl":0,"sso":0,"ded":0,"se":1,"ft":0,"sla":0,"u":{"Flash":0.7,"Plus":0.3}},
    {"n":"Basic","p":5,"c":1000,"v":5,"h":"1yr","ad":1,"ex":1,"db":1,"tl":0,"al":0,"api":0,"su":"basic","wl":0,"sso":0,"ded":0,"se":1,"ft":0,"sla":0,"u":{"Flash":0.6,"Plus":0.4}},
    {"n":"Plus","p":10,"c":3000,"v":10,"h":"unlim","ad":1,"ex":1,"db":1,"tl":1,"al":1,"api":0,"su":"basic","wl":0,"sso":0,"ded":0,"se":1,"ft":0,"sla":0,"u":{"Flash":0.5,"Plus":0.5}},
    {"n":"Pro","p":20,"c":8000,"v":20,"h":"unlim","ad":1,"ex":1,"db":1,"tl":1,"al":1,"api":1,"su":"priority","wl":0,"sso":0,"ded":0,"se":1,"ft":0,"sla":0,"u":{"Flash":0.4,"Plus":0.4,"Max":0.2}},
    {"n":"Max","p":40,"c":20000,"v":50,"h":"unlim","ad":1,"ex":1,"db":1,"tl":1,"al":1,"api":1,"su":"priority","wl":1,"sso":0,"ded":0,"se":5,"ft":0,"sla":0,"u":{"Flash":0.3,"Plus":0.4,"Max":0.3}},
    {"n":"Enterprise","p":100,"c":60000,"v":0,"h":"unlim","ad":1,"ex":1,"db":1,"tl":1,"al":1,"api":1,"su":"dedicated","wl":1,"sso":1,"ded":1,"se":20,"ft":1,"sla":1,"u":{"Flash":0.2,"Plus":0.4,"Max":0.4}},
]

for t in T:
    l = sum(cpc(m,CH)*pct*t["c"] for m,pct in t["u"].items())
    prk = t_perks(t)
    t["llm"]=l; t["prk"]=prk; t["tot"]=l+prk
    t["prof"]=max(0,t["p"]-t["tot"])
    t["marg"]=(t["prof"]/t["p"]*100) if t["p"]>0 else 0

# Print summary
print(f"{'Tier':<12} {'Price':<8} {'Credits':<10} {'LLM Cost':<12} {'Perk Cost':<12} {'Total':<12} {'Profit':<12} {'Margin':<10}")
print("="*88)
for t in T:
    print(f"{t['n']:<12} ${t['p']:<4}   {t['c']:<8} ${t['llm']:<8.4f}  ${t['prk']:<8.2f}  ${t['tot']:<8.2f}  ${t['prof']:<8.2f}  {t['marg']:<5.1f}%")

# ===== GRAPH =====
names = [t["n"] for t in T]
prices = [t["p"] for t in T]
llms = [t["llm"] for t in T]
prks = [t["prk"] for t in T]
totals = [t["tot"] for t in T]
margs = [t["marg"] for t in T]
colors = ['#95a5a6','#7f8c8d','#3498db','#2ecc71','#9b59b6','#e67e22','#e74c3c','#2c3e50']

fig, axes = plt.subplots(2, 3, figsize=(18, 12))
fig.suptitle("OBD-II Diagnostic App: 8-Tier Economics with Non-Model Perks", fontsize=18, fontweight='bold', y=1.01)

x = np.arange(len(names))

# Plot 1: Revenue vs Cost
ax = axes[0,0]
ax.bar(x, prices, 0.5, label='Revenue (price)', color='#2ecc71', alpha=0.85)
b1 = ax.bar(x, llms, 0.5, label='LLM API Cost', color='#e74c3c', alpha=0.85)
b2 = ax.bar(x, prks, 0.5, bottom=llms, label='Infra & Perks', color='#f39c12', alpha=0.85)
for i,(p,tc) in enumerate(zip(prices,totals)):
    if p>0: ax.text(i, p+2, f'+${p-tc:.2f}', ha='center', fontsize=9, fontweight='bold', color='#27ae60')
    ax.text(i, tc/2, f'${tc:.2f}', ha='center', fontsize=7.5, color='white', fontweight='bold')
ax.set_xticks(x); ax.set_xticklabels(names, fontsize=9)
ax.set_ylabel('$/user/month'); ax.set_title('Revenue vs Full Cost', fontweight='bold')
ax.legend(fontsize=8); ax.grid(axis='y', alpha=0.3); ax.set_ylim(0,115)

# Plot 2: Margins
ax = axes[0,1]
bars = ax.bar(x, margs, 0.5, color=colors, alpha=0.85)
for i,(m,p) in enumerate(zip(margs,prices)):
    if p>0: ax.text(i, m+1.5, f'{m:.1f}%', ha='center', fontsize=10, fontweight='bold')
    else: ax.text(i, 2, 'Free', ha='center', fontsize=9, style='italic', color='gray')
ax.set_xticks(x); ax.set_xticklabels(names, fontsize=9)
ax.set_ylabel('Profit Margin (%)'); ax.set_title('Profit Margin by Tier', fontweight='bold')
ax.grid(axis='y', alpha=0.3); ax.set_ylim(0,100)
ax.axhline(y=50, color='red', ls='--', alpha=0.5)
ax.text(7.5, 52, '50%', fontsize=8, color='red', alpha=0.7)

# Plot 3: Margins at different cache hits
ax = axes[0,2]
cache_hits = [0.30, 0.50, 0.70, 0.90]
for t in T:
    ms = []
    for ch in cache_hits:
        l = sum(cpc(m,ch)*pct*t["c"] for m,pct in t["u"].items())
        prk = t_perks(t)
        tot = l+prk
        m = (max(0,t["p"]-tot)/t["p"]*100) if t["p"]>0 else 0
        ms.append(m)
    if t["p"] > 0:
        ax.plot(cache_hits, ms, 'o-', linewidth=2, markersize=6, label=t["n"])
ax.set_xlabel('Cache Hit Rate'); ax.set_ylabel('Margin (%)')
ax.set_title('Margin Sensitivity to Cache Hits', fontweight='bold')
ax.legend(fontsize=7, ncol=2); ax.grid(alpha=0.3)
ax.set_xticks(cache_hits); ax.set_xticklabels(['30%','50%','70%','90%'])
ax.set_ylim(0, 100)

# Plot 4: Scale waterfall
ax = axes[1,0]
dist = [4000,1500,1500,1000,1000,500,300,200]
w2 = 0.25
revs = [d*p for d,p in zip(dist,prices)]
costs = [d*tot for d,tot in zip(dist,totals)]
profs = [r-c for r,c in zip(revs,costs)]
b1 = ax.bar(x-w2, revs, w2, label='Revenue', color='#2ecc71', alpha=0.85)
b2 = ax.bar(x, costs, w2, label='Cost', color='#e74c3c', alpha=0.85)
b3 = ax.bar(x+w2, profs, w2, label='Profit', color='#3498db', alpha=0.85)
for i,(r,c,pr) in enumerate(zip(revs,costs,profs)):
    if r>0: ax.text(i+w2, pr+200, f'+${pr:,}', ha='center', fontsize=5.5, fontweight='bold', rotation=90)
ax.set_xticks(x); ax.set_xticklabels([f'{n}\n({d})' for n,d in zip(names,dist)], fontsize=7)
ax.set_ylabel('Monthly $'); ax.set_title('Scale: 10,000 Users', fontweight='bold')
ax.legend(fontsize=7); ax.grid(axis='y', alpha=0.3)

# Plot 5: Cash flow
ax = axes[1,1]
total_rev = sum(revs)
total_llm = sum(d*l for d,l in zip(dist,llms))
total_prk = sum(d*p for d,p in zip(dist,prks))
total_cost = total_llm + total_prk
total_profit = total_rev - total_cost
cats = ['Revenue', 'LLM Costs', 'Perk Costs', 'Gross Profit']
vals = [total_rev, -total_llm, -total_prk, total_profit]
cws = ['#2ecc71','#e74c3c','#f39c12','#3498db']
bars = ax.bar(cats, vals, color=cws, alpha=0.85, width=0.6)
for i, (v, cat) in enumerate(zip(vals, cats)):
    pos = v/2 if v>0 else v/2
    c = 'white' if abs(v) > 5000 else '#333'
    ax.text(i, pos, f'${v:+,.0f}', ha='center', fontsize=11, fontweight='bold', color=c)
ax.set_ylabel('Monthly $'); ax.set_title(f'Cash Flow: ${total_rev:,.0f} → ${total_profit:,.0f}/mo', fontweight='bold')
ax.grid(axis='y', alpha=0.3); ax.axhline(y=0, color='black', lw=0.5)

# Plot 6: Cost breakdown horizontal
ax = axes[1,2]
# Build cost components
llm_layer = llms
storage_layer = [(t["v"]*0.01 if t["v"]>0 else 1.0) + hist_cost(t["h"]) for t in T]
features_layer = [sum([0.25*t["ad"],0.05*t["ex"],0.10*t["db"],0.50*t["tl"],0.20*t["al"],0.30*t["api"]]) for t in T]
premium_layer = [sum([{"basic":0,"std":0.30,"priority":0.50,"dedicated":3.00}[t["su"]],0.15*t["wl"],0.15*t["sso"],3.00*t["ded"],2.00*t["ft"],0.75*t["sla"],(t["se"]-1)*0.10]) for t in T]

bottom = np.zeros(len(names))
ax.barh(names, llm_layer, left=bottom, label='LLM API', color='#e74c3c', alpha=0.85)
bottom += np.array(llm_layer)
ax.barh(names, storage_layer, left=bottom, label='Storage', color='#3498db', alpha=0.85)
bottom += np.array(storage_layer)
ax.barh(names, features_layer, left=bottom, label='Features', color='#f39c12', alpha=0.85)
bottom += np.array(features_layer)
ax.barh(names, premium_layer, left=bottom, label='Premium', color='#9b59b6', alpha=0.85)
ax.set_xlabel('Cost ($/user/month)'); ax.set_title('Cost Breakdown (Horizontal Stack)', fontweight='bold')
ax.legend(fontsize=7); ax.grid(axis='x', alpha=0.3)

plt.tight_layout()
plt.savefig('./output/obdii_8tier_economics.png', dpi=150, bbox_inches='tight')
plt.close()
print("Graph saved successfully!")

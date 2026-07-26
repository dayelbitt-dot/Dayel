"""Compose the full ornate Ex8 crest (option A — green field, navy ground)."""
import cairosvg
from crest import (shield_segs, segs_to_d, sample_path, rope, W,H,
                   NAVY,GREEN,GREEN_D,GOLD,GOLD_L,GOLD_D,CREAM,INK,RED,HOP)
import elements as E

def build(path_png, path_svg, bg=NAVY, field=GREEN, motto="PADEL · CHURRASCO · CHOPP",
          ex8_face=CREAM, ex8_edge=GOLD_D, top_field=GREEN_D, top_dark="#0f2c1e"):
    cx=800
    outer=shield_segs(cx,300,360,560,1360,470,520)
    inner=shield_segs(cx,320,378,566,1332,444,492)
    innerline=shield_segs(cx,338,394,568,1300,420,468)
    S=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">']
    S.append(f'<rect width="{W}" height="{H}" fill="{bg}"/>')

    # corner scroll flourishes behind shield
    for sgn,fx in ((-1,True),(1,False)):
        S.append(f'<g transform="translate({cx+sgn*430},430) scale(1.5)">{E.flourish(flip=fx)}</g>')
        S.append(f'<g transform="translate({cx+sgn*400},980) scale(1.4)">{E.flourish(flip=fx)}</g>')

    # shield plates
    S.append(f'<path d="{segs_to_d(outer)}" fill="{GOLD}" stroke="{GOLD_D}" stroke-width="4"/>')
    S.append(f'<path d="{segs_to_d(inner)}" fill="{field}" stroke="{GREEN_D}" stroke-width="3"/>')
    S.append(rope(sample_path(outer,46)))
    S.append(f'<path d="{segs_to_d(innerline)}" fill="none" stroke="{GOLD}" stroke-width="3" opacity="0.7"/>')

    # clip so nothing spills out of the field
    S.append(f'<defs><clipPath id="fld"><path d="{segs_to_d(inner)}"/></clipPath></defs>')
    S.append('<g clip-path="url(#fld)">')

    # ---- top banner with hop vine ----
    S.append(E.banner(cx,372,560,66,fill=top_field,dark=top_dark,stroke=GOLD_D))
    S.append(f'<path d="M {cx-230} 372 Q {cx} 356 {cx+230} 372" fill="none" stroke="{HOP}" stroke-width="4" opacity="0.8"/>')
    for i,xx in enumerate(range(cx-200,cx+201,66)):
        S.append(f'<g transform="translate({xx},372) scale(0.42)">{E.hop()}</g>')

    # ---- upper emblem: crossed knife & fork (behind), rackets (front), ball, grill ----
    EC=(cx,548)
    S.append(f'<g transform="translate({EC[0]},{EC[1]}) rotate(-46) scale(1.06) translate(0,45)">{E.knife()}</g>')
    S.append(f'<g transform="translate({EC[0]},{EC[1]}) rotate(46) scale(1.06) translate(0,45)">{E.fork()}</g>')
    S.append(f'<g transform="translate({EC[0]},{EC[1]}) rotate(-29) scale(0.78) translate(0,132)">{E.racket()}</g>')
    S.append(f'<g transform="translate({EC[0]},{EC[1]}) rotate(29) scale(0.78) translate(0,132)">{E.racket()}</g>')
    S.append(f'<g transform="translate({cx},430) scale(1.0)">{E.ball(r=30)}</g>')
    S.append(f'<g transform="translate({cx},648) scale(0.72)">{E.grill()}</g>')

    # ---- dividers + EX8 ----
    S.append(E.divider(cx,740,470))
    S.append(E.emblem_text("EX8",cx,828,168,face=ex8_face,edge=ex8_edge))
    S.append(f'<g transform="translate({cx-300},812) scale(1.0)">{E.hop()}</g>')
    S.append(f'<g transform="translate({cx-256},886) scale(0.72)">{E.hop()}</g>')
    S.append(f'<g transform="translate({cx+284},898) scale(1.0)">{E.wheat()}</g>')
    S.append(f'<g transform="translate({cx+328},898) scale(0.85)">{E.wheat()}</g>')
    S.append(E.divider(cx,916,470))

    # ---- lower emblem: pots + clinking mugs + hops ----
    S.append(f'<g transform="translate({cx-176},1010) scale(0.95)">{E.panela()}</g>')
    S.append(f'<g transform="translate({cx+176},1010) scale(0.95)">{E.panela()}</g>')
    # splash between mugs
    S.append(f'<g transform="translate({cx-58},1020) rotate(-12) scale(1.02)">{E.mug()}</g>')
    S.append(f'<g transform="translate({cx+58},1020) rotate(12) scale(1.02)">{E.mug(flip=True)}</g>')
    for dx,dy in ((0,940),(-24,960),(24,958)):
        S.append(f'<circle cx="{cx+dx}" cy="{dy}" r="5" fill="{CREAM}" opacity="0.85"/>')
    S.append(f'<g transform="translate({cx-70},1150) scale(0.55)">{E.hop()}</g>')
    S.append(f'<g transform="translate({cx+70},1150) scale(0.55)">{E.hop()}</g>')

    S.append('</g>')  # end clip

    # ---- bottom ribbon banner ----
    S.append(E.banner(cx,1250,470,82,fill=GOLD,dark=GOLD_D,stroke=GOLD_D))
    S.append(E.emblem_text(motto,cx,1250,34,face=GREEN_D,edge=GREEN_D,
                           shadow="#0f2c1e",ls=1.5))

    # ---- star finial on top ----
    S.append(f'<g transform="translate({cx},250) scale(1.0)">{E.star(r=46)}</g>')
    S.append(f'<g transform="translate({cx-64},262) scale(0.9)">{E.flourish(flip=True)}</g>')
    S.append(f'<g transform="translate({cx+64},262) scale(0.9)">{E.flourish()}</g>')

    S.append('</svg>')
    doc="".join(S)
    open(path_svg,"w").write(doc)
    cairosvg.svg2png(bytestring=doc.encode(),write_to=path_png,output_width=1200,output_height=1200)
    print("built",path_png)

if __name__=="__main__":
    # Option A — verde clássico sobre navy
    build("/home/user/Dayel/design/ex8_A.png","/home/user/Dayel/design/ex8_A.svg",
          bg=NAVY, field=GREEN, motto="PADEL · CHURRASCO · CHOPP")
    # Option B — navy sobre pergaminho (creme)
    build("/home/user/Dayel/design/ex8_B.png","/home/user/Dayel/design/ex8_B.svg",
          bg="#efe6c9", field="#1e3357", motto="TIME EX8 · DESDE A 1ª BRASA",
          ex8_face=CREAM, ex8_edge=GOLD_D, top_field="#16274a", top_dark="#0e1a33")
    # Option C — brasa: grafite sobre verde escuro, EX8 dourado
    build("/home/user/Dayel/design/ex8_C.png","/home/user/Dayel/design/ex8_C.svg",
          bg="#123024", field="#2a2521", motto="RAQUETE · BRASA · CHOPP",
          ex8_face=GOLD_L, ex8_edge=GOLD_D, top_field="#1c1917", top_dark="#0d0b0a")
    print("all three built")

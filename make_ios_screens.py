from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
out=Path(r'C:\Users\joseph marvin\Downloads'); W,H=1284,2778
bg=(248,246,239); green=(18,101,78); dark=(20,39,34); gold=(194,145,47); muted=(100,114,107); white=(255,255,255); line=(225,222,213)
font=r'C:\\Windows\\Fonts\\arial.ttf'; bold=r'C:\\Windows\\Fonts\\arialbd.ttf'; serif=r'C:\\Windows\\Fonts\\georgia.ttf'; serifb=r'C:\\Windows\\Fonts\\georgiab.ttf'
def F(p,s): return ImageFont.truetype(p,s)
def center(d,t,y,f,c):
    box=d.textbbox((0,0),t,font=f); d.text(((W-(box[2]-box[0]))/2,y),t,font=f,fill=c)
def rr(d,box,r,fill): d.rounded_rectangle(box,radius=r,fill=fill)
def header(d):
    d.text((50,30),'9:41',font=F(bold,30),fill=(0,0,0)); rr(d,(52,108,132,188),20,white); d.line((72,140,112,140),fill=dark,width=5); d.line((72,154,112,154),fill=dark,width=5); d.line((72,168,112,168),fill=dark,width=5); d.text((150,115),'Legal ',font=F(bold,42),fill=(0,0,0)); d.text((325,115),'Advisor',font=F(bold,42),fill=gold); rr(d,(1075,108,1150,188),20,white); d.ellipse((1097,130,1125,158),outline=dark,width=4); d.ellipse((1107,140,1115,148),fill=dark); rr(d,(1160,108,1265,188),20,green); d.text((1175,133),'Sign in',font=F(bold,25),fill=white); d.line((0,220,W,220),fill=line,width=2)
def base(): im=Image.new('RGB',(W,H),bg); return im,ImageDraw.Draw(im)
# home
im,d=base();header(d);center(d,'LEGAL GUIDANCE, MADE HUMAN',420,F(bold,25),green);center(d,'Legal help starts',540,F(serifb,72),dark);center(d,'with',635,F(serifb,72),dark);center(d,'understanding.',730,F(serif,78),green);center(d,"Tell the Legal Advisor what's",930,F(font,34),muted);center(d,'happening. Understand the law,',985,F(font,34),muted);center(d,'explore your options, and connect',1040,F(font,34),muted);center(d,'with the right lawyer when you need one.',1095,F(font,34),muted);rr(d,(80,1270,1204,1690),40,white);d.text((140,1360),"Tell me what's happening in your",font=F(font,30),fill=muted);d.text((140,1415),'own words...',font=F(font,30),fill=muted);d.line((130,1515,1135,1515),fill=line,width=2);d.text((140,1570),'Uganda · Private & secure',font=F(font,26),fill=muted);rr(d,(700,1540,1150,1655),22,green);d.text((755,1575),'Ask a legal question',font=F(bold,27),fill=white);center(d,'Or start here:',1765,F(font,25),muted)
for text,x,y,w in [('Work problem',210,1810,285),('Housing',600,1810,285),('Contract',430,1925,260)]: rr(d,(x,y,x+w,y+78),36,white); d.text((x+35,y+24),text,font=F(font,25),fill=green)
im.save(out/'LegalAdvisor-iPhone-home-1284x2778.png')
# chat
im,d=base();header(d);d.text((80,330),'Legal Assistant',font=F(serifb,58),fill=dark);d.text((82,420),'Uganda · Online',font=F(font,25),fill=green);rr(d,(360,590,1180,765),32,green);d.text((410,640),'My landlord locked me out.',font=F(font,31),fill=white);rr(d,(80,860,1150,1410),35,white);d.text((130,930),'I’m sorry you’re dealing with this.',font=F(bold,31),fill=dark);d.text((130,1000),'Let’s clarify what happened so I can',font=F(font,30),fill=dark);d.text((130,1055),'explain your options under Ugandan law.',font=F(font,30),fill=dark);d.text((130,1140),'Did you receive a written notice?',font=F(font,30),fill=dark);d.text((130,1260),'Your information is private and secure.',font=F(font,25),fill=muted);rr(d,(80,2240,1204,2410),30,white);d.text((125,2300),'Type your legal question...',font=F(font,29),fill=muted);rr(d,(1035,2265,1155,2375),25,green);d.text((1070,2290),'?',font=F(bold,42),fill=white);im.save(out/'LegalAdvisor-iPhone-assistant-1284x2778.png')
# lawyers
im,d=base();header(d);d.text((80,340),'Find the right lawyer',font=F(serifb,58),fill=dark);d.text((82,435),'Verified advocates available in Uganda',font=F(font,27),fill=muted);rr(d,(80,550,1204,665),28,white);d.text((125,590),'?  Search by legal issue or location',font=F(font,28),fill=muted)
for i,(name,spec) in enumerate([('Amina K. · Kampala','Family & property law'),('David M. · Entebbe','Employment & contracts'),('Sarah N. · Jinja','Civil litigation')]):
 y=800+i*430;rr(d,(80,y,1204,y+350),32,white);rr(d,(135,y+70,255,y+190),60,green);d.text((175,y+94),name[0],font=F(serifb,54),fill=white);d.text((300,y+75),name,font=F(bold,32),fill=dark);d.text((300,y+125),'? Verified lawyer',font=F(font,24),fill=green);d.text((300,y+180),spec,font=F(font,25),fill=muted);rr(d,(860,y+220,1125,y+292),20,green);d.text((900,y+242),'View profile',font=F(bold,23),fill=white)
im.save(out/'LegalAdvisor-iPhone-lawyers-1284x2778.png')
print('done')




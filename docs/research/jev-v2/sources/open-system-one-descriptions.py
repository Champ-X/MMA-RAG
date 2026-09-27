"""丰富的选项描述（enriched criteria）—— 公平性对比用。

为什么要这个文件：我们之前只给了所有方案**裸标签名**（`card_arrival`、`Sci/Tech`），
但 Cloudflare 官方示例里 Jev 的 `criteria` 是带描述的完整句子。
如果 Jev 在丰富描述下涨分，而我们没测，发布出去的结论就是错的。

纪律：**同一份描述，一字不差地喂给所有方案**（Jev 的 criteria、
交叉编码的 NLI 假设句、双塔的选项向量）。描述写的是标签的含义，
不含任何来自标注数据的信息——这是部署者本来就会写的东西。
"""

ENRICHED = {
"sst2": {
 "negative sentiment": "The movie review expresses a negative opinion: the writer disliked the film.",
 "positive sentiment": "The movie review expresses a positive opinion: the writer liked the film.",
},
"ag_news": {
 "World": "International news: world politics, conflicts, disasters and events in other countries.",
 "Sports": "Sports news: games, matches, athletes, teams, tournaments and results.",
 "Business": "Business and finance news: companies, markets, stocks, the economy and trade.",
 "Sci/Tech": "Science and technology news: research, computing, the internet, gadgets and space.",
},
"emotion": {
 "sadness": "The writer feels sad, unhappy, disappointed or depressed.",
 "joy": "The writer feels happy, joyful, glad or pleased.",
 "love": "The writer feels love, affection, tenderness or caring towards someone.",
 "anger": "The writer feels angry, furious, annoyed or irritated.",
 "fear": "The writer feels afraid, scared, anxious or nervous.",
 "surprise": "The writer feels surprised, amazed, astonished or shocked.",
},
"banking77": {
 "activate my card": "The customer wants to activate a new card.",
 "age limit": "The customer asks about the minimum age needed to open or use an account.",
 "apple pay or google pay": "The customer asks about paying with Apple Pay or Google Pay.",
 "atm support": "The customer asks which ATMs or cash machines they can use.",
 "automatic top up": "The customer asks about setting up automatic top-ups.",
 "balance not updated after bank transfer": "The customer sent a bank transfer but the balance has not updated.",
 "balance not updated after cheque or cash deposit": "The customer deposited cash or a cheque but the balance has not updated.",
 "beneficiary not allowed": "The customer cannot add or pay a beneficiary because it is not allowed.",
 "cancel transfer": "The customer wants to cancel a transfer they already made.",
 "card about to expire": "The customer's card is expiring soon and they ask what happens next.",
 "card acceptance": "The customer asks where the card is accepted, which merchants or countries.",
 "card arrival": "The customer asks when an ordered card will arrive or why it has not arrived.",
 "card delivery estimate": "The customer asks how long card delivery normally takes.",
 "card linking": "The customer wants to link an external card to the account.",
 "card not working": "The customer's card is being rejected or does not work.",
 "card payment fee charged": "The customer was charged a fee on a card payment.",
 "card payment not recognised": "The customer does not recognise a card payment on the statement.",
 "card payment wrong exchange rate": "A card payment used what the customer thinks is the wrong exchange rate.",
 "card swallowed": "A cash machine swallowed or retained the customer's card.",
 "cash withdrawal charge": "The customer was charged a fee for withdrawing cash.",
 "cash withdrawal not recognised": "The customer does not recognise a cash withdrawal on the statement.",
 "change pin": "The customer wants to change the PIN of their card.",
 "compromised card": "The customer believes their card details have been stolen or compromised.",
 "contactless not working": "Contactless or tap payments are not working.",
 "country support": "The customer asks which countries are supported or can open an account.",
 "declined card payment": "A card payment was declined or refused.",
 "declined cash withdrawal": "A cash withdrawal was declined or refused.",
 "declined transfer": "A transfer was declined or refused.",
 "direct debit payment not recognised": "The customer does not recognise a direct debit on the statement.",
 "disposable card limits": "The customer asks about limits on disposable virtual cards.",
 "edit personal details": "The customer wants to change their personal details on the account.",
 "exchange charge": "The customer was charged a fee for exchanging currency.",
 "exchange rate": "The customer asks about the exchange rate that is or was applied.",
 "exchange via app": "The customer asks how to exchange currency inside the app.",
 "extra charge on statement": "There is an unexpected extra charge on the statement.",
 "failed transfer": "A transfer failed and did not go through.",
 "fiat currency support": "The customer asks which traditional currencies are supported.",
 "get disposable virtual card": "The customer wants to get a disposable virtual card.",
 "get physical card": "The customer asks how to get a physical card.",
 "getting spare card": "The customer wants an additional or spare card.",
 "getting virtual card": "The customer wants to get a virtual card.",
 "lost or stolen card": "The customer's card has been lost or stolen.",
 "lost or stolen phone": "The customer's phone has been lost or stolen.",
 "order physical card": "The customer wants to order a physical card.",
 "passcode forgotten": "The customer has forgotten their app passcode and is locked out.",
 "pending card payment": "A card payment is still pending and has not settled.",
 "pending cash withdrawal": "A cash withdrawal is still pending and has not settled.",
 "pending top up": "A top-up is still pending and has not completed.",
 "pending transfer": "A transfer is still pending and has not completed.",
 "pin blocked": "The card PIN is blocked after wrong attempts.",
 "receiving money": "The customer asks about receiving money from someone else.",
 "Refund not showing up": "An expected refund has not appeared in the account.",
 "request refund": "The customer wants to request a refund for a payment.",
 "reverted card payment?": "A card payment was reverted or reversed back.",
 "supported cards and currencies": "The customer asks which cards and currencies are supported.",
 "terminate account": "The customer wants to close or delete their account.",
 "top up by bank transfer charge": "The customer was charged for topping up by bank transfer.",
 "top up by card charge": "The customer was charged for topping up with a card.",
 "top up by cash or cheque": "The customer asks about topping up using cash or a cheque.",
 "top up failed": "A top-up failed and the money did not arrive.",
 "top up limits": "The customer asks about limits on how much they can top up.",
 "top up reverted": "A top-up was reverted and the money was sent back.",
 "topping up by card": "The customer asks how to top up the account using a card.",
 "transaction charged twice": "A transaction was charged twice, a duplicate charge.",
 "transfer fee charged": "The customer was charged a fee on a transfer.",
 "transfer into account": "The customer asks about transferring money into their account.",
 "transfer not received by recipient": "The recipient has not received a transfer the customer sent.",
 "transfer timing": "The customer asks how long a transfer takes to arrive.",
 "unable to verify identity": "The customer cannot complete identity verification.",
 "verify my identity": "The customer wants to verify their identity.",
 "verify source of funds": "The customer is asked to prove where their money came from.",
 "verify top up": "The customer needs to verify a top-up before it completes.",
 "virtual card not working": "The customer's virtual card is not working.",
 "visa or mastercard": "The customer asks whether the card is Visa or Mastercard.",
 "why verify identity": "The customer asks why identity verification is required.",
 "wrong amount of cash received": "The cash machine gave the wrong amount of cash.",
 "wrong exchange rate for cash withdrawal": "A cash withdrawal used the wrong exchange rate.",
},
}


def describe(ds: str, options: list[str], enriched: bool) -> list[str]:
    """裸标签名 or 丰富描述。缺描述的标签退回标签名本身并告警——
    静默退回会让某几个选项悄悄处于不同条件下，那就不是公平对比了。"""
    if not enriched:
        return list(options)
    m = ENRICHED.get(ds, {})
    missing = [o for o in options if o not in m]
    if missing:
        raise KeyError(f"{ds} 缺少描述: {missing}")
    return [m[o] for o in options]

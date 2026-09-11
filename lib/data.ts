// ═══════════════════════════════════════════════
// RONNY'S PIZZA — data (ported verbatim from the v12 static app)
// ═══════════════════════════════════════════════

export type Lang = "en" | "ka";

export interface Pizza {
  id: number;
  tier: "standard" | "house";
  name: string;
  name_ka: string;
  emoji: string;
  badge?: string | null;
  badge_ka?: string;
  tagline: string;
  tagline_ka: string;
  sizes: [number, number, number]; // [S 20cm, M 30cm, XL 45cm]
  ings: string[];
  defaultExtras?: Record<string, { whole: number; left: number; right: number }>;
  isBYO?: boolean;
}

export const SEED_PIZZAS: Pizza[] = [
  { id:1,  tier:"standard", name:"Papa Ronny",    name_ka:"პაპა რონი",    emoji:"🍕", badge:"Most ordered", badge_ka:"პოპულარული", tagline:"The classic that started it all. Simple, honest, and always right.", tagline_ka:"კლასიკა, რომლითაც ყველაფერი დაიწყო. მარტივი, გულწრფელი და ყოველთვის სწორი.", sizes:[11.3,24.5,45.9], ings:["Pepperoni","Mozzarella"] },
  { id:2,  tier:"standard", name:"Driftin'",      name_ka:"დრიფტინ'",     emoji:"🍕", badge:null,           tagline:"Extra mozzarella, smoked ham, mushrooms. Comfort in every bite.",  tagline_ka:"მეტი მოცარელა, შებოლილი ლორი, სოკო. სიმყუდროვე ყოველ ნაკბენში.", sizes:[14.8,32.4,58.9], ings:["Mozzarella","Smoked Ham","Fresh Mushrooms"], defaultExtras:{ "Mozzarella": { whole: 1, left: 0, right: 0 } } },
  { id:3,  tier:"standard", name:"Hot Rod",       name_ka:"ჰოთ როდი",    emoji:"🌶️", badge:null,  tagline:"For those who aren't afraid of the heat.", tagline_ka:"მათთვის, ვისაც ცხარე არ აშინებს.", sizes:[12.7,27.6,50.8], ings:["Mozzarella","Pepperoni","Fresh Tomatoes","Red Chili Flakes"] },
  { id:4,  tier:"standard", name:"Smokin'",       name_ka:"სმოკინ'",      emoji:"🍕", badge:null,           tagline:"Smoked cheese, roasted chicken, fresh tomato. Unforgettable.", tagline_ka:"შებოლილი ყველი, შემწვარი ქათამი, ახალი პომიდორი. დაუვიწყარია.", sizes:[14.8,32.4,58.9], ings:["Mozzarella","Smoked Cheese","Roasted Chicken","Fresh Tomatoes"] },
  { id:5,  tier:"standard", name:"Cruiser",       name_ka:"კრუიზერი",    emoji:"🍕", badge:null,           tagline:"Pepperoni, mushrooms, olives. The easy rider.", tagline_ka:"პეპერონი, სოკო, ზეთისხილი. მსუბუქი არჩევანი.", sizes:[14.1,30.7,55.7], ings:["Mozzarella","Pepperoni","Fresh Mushrooms","Black Olives"] },
  { id:6,  tier:"standard", name:"Wild West",     name_ka:"ველური დასავლეთი", emoji:"🤠", badge:"Staff pick", badge_ka:"ჩვენი არჩევანი", tagline:"BBQ chicken and roasted garlic. Boldly different.", tagline_ka:"ბბქ ქათამი და შემწვარი ნიორი. გაბედულად განსხვავებული.", sizes:[12.7,27.6,50.8], ings:["Mozzarella","BBQ Chicken","Roasted Garlic"] },
  { id:7,  tier:"standard", name:"Hula",          name_ka:"ჰულა",         emoji:"🍍", badge:null,           tagline:"Ham and sweet pineapple. The tropical one.", tagline_ka:"ლორი და ტკბილი ანანასი. ტროპიკული.", sizes:[13.1,28.3,52.0], ings:["Mozzarella","Smoked Ham","Pineapple"] },
  { id:8,  tier:"house",    name:"Supreme",       name_ka:"სუპრემე",      emoji:"👑", badge:null,           tagline:"Everything on it. Because you deserve everything.", tagline_ka:"ყველაფერი ერთად. რადგან ყველაფრის ღირსი ხარ.", sizes:[15.6,35.1,59.9], ings:["Mozzarella","Pepperoni","Smoked Ham","Italian Sausage","Onions","Sweet Peppers","Fresh Mushrooms","Black Olives"] },
  { id:9,  tier:"house",    name:"4x4",           name_ka:"4x4",         emoji:"🥩", badge:null,           tagline:"Four meats, four reasons to order.", tagline_ka:"ოთხი ხორცი, ოთხი მიზეზი შესაკვეთად.", sizes:[15.1,34.7,59.3], ings:["Mozzarella","Pepperoni","Italian Sausage","Smoked Ham","Salami"] },
  { id:10, tier:"house",    name:"Cheesy Veggie", name_ka:"ყველიანი ბოსტნეული", emoji:"🥦", badge:"Vegetarian", badge_ka:"ვეგეტარიანული", tagline:"Loaded with mushrooms, peppers, olives, and Italian seasoning.", tagline_ka:"სოკო, წიწაკა, ზეთისხილი და იტალიური სანელებლები.", sizes:[14.2,30.9,56.2], ings:["Mozzarella","Fresh Mushrooms","Sweet Peppers","Onions","Black Olives","Italian Seasoning"] },
  { id:11, tier:"house",    name:"Vegan",         name_ka:"ვეგანური",     emoji:"🌿", badge:"Vegan",        badge_ka:"ვეგანური", tagline:"No cheese, no compromise. Plant-powered.", tagline_ka:"ყველის გარეშე. სრულად მცენარეული.", sizes:[14.4,31.1,57.1], ings:["Roasted Mushrooms","Fresh Mushrooms","Fresh Tomatoes","Sweet Peppers","Onions","Black Olives","Italian Seasoning"] },
  { id:12, tier:"house",    name:"Cheese Lovers", name_ka:"ყველის მოყვარულთათვის", emoji:"🧀", badge:null,           tagline:"Four cheeses melted together. Simple. Perfect.", tagline_ka:"ოთხი ყველი ერთად. მარტივი. სრულყოფილი.", sizes:[15.8,35.9,61.5], ings:["Blue Cheese","Parmesan","Smoked Cheese","Mozzarella"] },
  { id:13, tier:"house",    name:"Classic Cheese",name_ka:"კლასიკური ყველი", emoji:"🍕", badge:null,           tagline:"Just mozzarella and marinara. The purest form.", tagline_ka:"მხოლოდ მოცარელა და მარინარა. წმინდა ფორმა.", sizes:[9.5,20.7,39.8],  ings:["Mozzarella"] },
  { id:14, tier:"house",    name:"My Pizza",       name_ka:"ჩემი პიცა",       emoji:"🍕", badge:null,           tagline:"Start from scratch. Your size, your crust, your toppings.", tagline_ka:"ნულიდან. შენი ზომა, ტესტო, დანამატები.", sizes:[9.5,20.7,39.8],  ings:["Mozzarella"], isBYO:true },
];

export interface Topping {
  name: string;
  name_ka: string;
  emoji: string;
  ps: [number, number, number];
  dots: string[];
  recipeOnly?: boolean;
}

export const SEED_TOPPINGS: Topping[] = [
  { name:"Mozzarella",        name_ka:"მოცარელა",        emoji:"🧀", ps:[2.1,4.8,8.1], dots:["cheese"] },
  { name:"Smoked Cheese",     name_ka:"შებოლილი ყველი",   emoji:"🧀", ps:[2.1,4.8,8.1], dots:["cheese"] },
  { name:"Blue Cheese",       name_ka:"ლურჯი ყველი",      emoji:"🧀", ps:[2.1,4.8,8.1], dots:["cheese"], recipeOnly:true },
  { name:"Parmesan",          name_ka:"პარმეზანი",        emoji:"🧀", ps:[2.1,4.8,8.1], dots:["cheese"], recipeOnly:true },
  { name:"Pepperoni",         name_ka:"პეპერონი",         emoji:"🍖", ps:[1.8,3.8,6.1], dots:["protein"] },
  { name:"Salami",            name_ka:"სალამი",           emoji:"🥩", ps:[1.8,3.8,6.1], dots:["protein"] },
  { name:"Smoked Ham",        name_ka:"შებოლილი ლორი",    emoji:"🥓", ps:[1.8,3.8,6.1], dots:["protein"] },
  { name:"Italian Sausage",   name_ka:"იტალიური სოსისი",  emoji:"🌭", ps:[1.8,3.8,6.1], dots:["protein"] },
  { name:"Roasted Chicken",   name_ka:"შემწვარი ქათამი",  emoji:"🍗", ps:[1.8,3.8,6.1], dots:["protein"] },
  { name:"BBQ Chicken",       name_ka:"ბბქ ქათამი",       emoji:"🍗", ps:[1.8,3.8,6.1], dots:["protein"] },
  { name:"Anchovies",         name_ka:"ანჩოუსი",          emoji:"🐟", ps:[1.8,3.8,6.1], dots:["protein"] },
  { name:"Pineapple",         name_ka:"ანანასი",          emoji:"🍍", ps:[1.8,3.8,6.1], dots:["veg"] },
  { name:"Green Olives",      name_ka:"მწვანე ზეთისხილი", emoji:"🫒", ps:[1.8,3.8,6.1], dots:["veg"] },
  { name:"Roasted Mushrooms", name_ka:"შემწვარი სოკო",    emoji:"🍄", ps:[1.4,3.1,4.9], dots:["veg"], recipeOnly:true },
  { name:"Fresh Mushrooms",   name_ka:"ახალი სოკო",       emoji:"🍄", ps:[1.4,3.1,4.9], dots:["veg"] },
  { name:"Sweet Peppers",     name_ka:"ტკბილი წიწაკა",    emoji:"🫑", ps:[1.4,3.1,4.9], dots:["veg"] },
  { name:"Black Olives",      name_ka:"შავი ზეთისხილი",   emoji:"🫒", ps:[1.4,3.1,4.9], dots:["veg"] },
  { name:"Fresh Tomatoes",    name_ka:"ახალი პომიდორი",   emoji:"🍅", ps:[1.4,3.1,4.9], dots:["veg"] },
  { name:"Onions",            name_ka:"ხახვი",            emoji:"🧅", ps:[1.4,3.1,4.9], dots:["veg"] },
  { name:"Roasted Garlic",    name_ka:"შემწვარი ნიორი",   emoji:"🧄", ps:[1.4,3.1,4.9], dots:["veg"] },
  { name:"Fresh Hot Peppers", name_ka:"ცხარე წიწაკა",     emoji:"🌶️", ps:[1.4,3.1,4.9], dots:["heat"] },
  { name:"Jalapeno Peppers",  name_ka:"ხალაპენიო",        emoji:"🌶️", ps:[1.4,3.1,4.9], dots:["heat"] },
  { name:"Red Chili Flakes",  name_ka:"წითელი წიწაკის ფანტელები", emoji:"🌶️", ps:[0,0,0], dots:["heat"] },
  { name:"Italian Seasoning", name_ka:"იტალიური სანელებლები", emoji:"🌿", ps:[0,0,0], dots:["veg"], recipeOnly:true },
];

export const SEED_PIZZA_PHOTOS: Record<number, string> = {
  1:  "https://ronnyspizza.com/product_images/medium-pizza-papa_ronny-ronnys_pizza.png",
  2:  "https://ronnyspizza.com/product_images/medium-pizza-driftin'-ronnys_pizza.png",
  3:  "https://ronnyspizza.com/product_images/medium-pizza-hot_rod-ronnys_pizza.png",
  4:  "https://ronnyspizza.com/product_images/medium-pizza-smokin'-ronnys_pizza.png",
  5:  "https://ronnyspizza.com/product_images/medium-pizza-cruiser-ronnys_pizza.png",
  6:  "https://ronnyspizza.com/product_images/medium-pizza-wild_west-ronnys_pizza.png",
  7:  "https://ronnyspizza.com/product_images/medium-pizza-hula-ronnys_pizza.png",
  8:  "https://ronnyspizza.com/product_images/medium-pizza-supreme-ronnys_pizza.png",
  9:  "https://ronnyspizza.com/product_images/medium-pizza-4x4-ronnys_pizza.png",
  10: "https://ronnyspizza.com/product_images/medium-pizza-cheesy_veggie-ronnys_pizza.png",
  11: "https://ronnyspizza.com/product_images/medium-pizza-vegan-ronnys_pizza.png",
  12: "https://ronnyspizza.ge/product_images/medium-pizza-cheese_lovers-ronnys_pizza.png",
  13: "https://ronnyspizza.com/product_images/medium-pizza-classic_cheese-ronnys_pizza.png",
};

export const SEED_TOPPING_PHOTOS: Record<string, string> = {
  "Mozzarella":         "https://staging.ronnys.ge/wp-content/uploads/2026/04/Mozzarella-150x150.jpg",
  "Smoked Cheese":      "https://staging.ronnys.ge/wp-content/uploads/2026/04/Smoked-Cheese-150x150.jpg",
  "Pepperoni":          "https://staging.ronnys.ge/wp-content/uploads/2026/04/Pepperoni-150x150.jpg",
  "Salami":             "https://staging.ronnys.ge/wp-content/uploads/2026/04/Salami-150x150.jpg",
  "Smoked Ham":         "https://staging.ronnys.ge/wp-content/uploads/2026/04/Smoked-Ham-150x150.jpg",
  "Italian Sausage":    "https://staging.ronnys.ge/wp-content/uploads/2026/04/Italian-Sausage-150x150.jpg",
  "Roasted Chicken":    "https://staging.ronnys.ge/wp-content/uploads/2026/04/Roasted-Chicken-150x150.jpg",
  "BBQ Chicken":        "https://staging.ronnys.ge/wp-content/uploads/2026/04/BBQ-Chicken-1-150x150.jpg",
  "Anchovies":          "https://staging.ronnys.ge/wp-content/uploads/2026/04/Anchovies-1-150x150.jpg",
  "Pineapple":          "https://staging.ronnys.ge/wp-content/uploads/2026/04/Pineapple-150x150.jpg",
  "Green Olives":       "https://staging.ronnys.ge/wp-content/uploads/2026/04/Green-Olives-150x150.jpg",
  "Fresh Mushrooms":    "https://staging.ronnys.ge/wp-content/uploads/2026/04/Mushrooms-2-150x150.jpg",
  "Sweet Peppers":      "https://staging.ronnys.ge/wp-content/uploads/2026/04/Sweet-Peppers-150x150.png",
  "Black Olives":       "https://staging.ronnys.ge/wp-content/uploads/2026/04/Black-Olives-150x150.png",
  "Onions":             "https://staging.ronnys.ge/wp-content/uploads/2026/04/Onions-150x150.png",
  "Roasted Garlic":     "https://staging.ronnys.ge/wp-content/uploads/2026/04/Roasted-Garlic-150x150.jpg",
  "Fresh Tomatoes":     "https://staging.ronnys.ge/wp-content/uploads/2026/04/Tomatoes-150x150.jpg",
  "Fresh Hot Peppers":  "https://staging.ronnys.ge/wp-content/uploads/2026/04/Hot-peppers-150x150.jpg",
  "Jalapeno Peppers":   "https://staging.ronnys.ge/wp-content/uploads/2026/04/Jalapeno-Peppers-150x150.png",
  "Red Chili Flakes":   "https://staging.ronnys.ge/wp-content/uploads/2026/04/Red-Pepper-Flakes-150x150.png",
};

export const SEED_POPULAR = ["Mozzarella","Pepperoni","Smoked Ham","Roasted Chicken","BBQ Chicken","Fresh Mushrooms","Sweet Peppers","Fresh Tomatoes","Pineapple","Salami"];
export let MAX_TOPPINGS = 6;
export let MIN_ORDER = 25;
export let FREE_DELIVERY = 60;
export let DELIVERY_FEE = 5.5;

export interface Item {
  id: string;
  name: string;
  name_ka: string;
  price: number;
  desc: string;
  desc_ka: string;
  emoji: string;
  builder?: "sticks" | "cinsticks";
  photo?: string;
}

export const SEED_EXTRAS: Item[] = [
  { id: "sticks",  name: "Super Sticks", name_ka: "სუპერ ჯოხები", price: 4.20, desc: "Crispy outside, soft inside. Add mozzarella!", desc_ka: "გარედან ხრაშუნა, შიგნით რბილი. დაამატე მოცარელა!", emoji: "🥖", builder: "sticks", photo: "https://ronnyspizza.com/product_images/extras-bread_sticks-super_sticks-ronnys_pizza.png" },
  { id: "cinsticks", name: "Sweet Cinnamon Sticks", name_ka: "ტკბილი დარიჩინის ჯოხები", price: 4.20, desc: "Warm, golden, dusted with cinnamon sugar. Served with icing.", desc_ka: "თბილი, ოქროსფერი, დარიჩინ-შაქრით მოყრილი. გლეზურით.", emoji: "🥖", builder: "cinsticks", photo: "https://ronnyspizza.com/product_images/extras-bread_sticks-cinnamon_sticks-ronnys_pizza.png" },
  { id: "cookies", name: "Chocolate Chip Cookies", name_ka: "შოკოლადის ჩიფსიანი ფუნთუშები", price: 3.90, desc: "Ronny's famous cookies, baked fresh every day.", desc_ka: "რონის ცნობილი ფუნთუშები, ყოველდღე ახლად გამომცხვარი.", emoji: "🍪", photo: "https://ronnyspizza.com/product_images/cookies.png" },
];

export const SEED_SAUCES: Item[] = [
  { id: "ranch",    name: "Ranch Sauce", name_ka: "რენჩი", price: 1.80, desc: "America's favorite creamy dip. Perfect for breadsticks, pizza, or wings.", desc_ka: "ამერიკის საყვარელი ნაღებიანი სოუსი. ჯოხებისთვის, პიცისთვის ან ფრთებისთვის.", emoji: "🥛", photo: "https://staging.ronnys.ge/wp-content/uploads/2026/04/extras-ranch_sauce-ronnys_pizza.png" },
  { id: "marinara", name: "Marinara Sauce", name_ka: "მარინარა სოუსი", price: 1.80, desc: "Our house-made marinara, for extra dipping.", desc_ka: "ჩვენი სახლში მომზადებული მარინარა, დასავლები.", emoji: "🥫", photo: "https://ronnyspizza.ge/product_images/marinara.png" },
  { id: "spicy",    name: "Spicy Sauce", name_ka: "ცხარე სოუსი", price: 1.80, desc: "For when you want more heat on the side.", desc_ka: "როცა მეტი სიცხარე გინდა გვერდით.", emoji: "🌶️", photo: "https://ronnyspizza.ge/product_images/spicy.png" },
  { id: "icing",    name: "Icing", name_ka: "გლეზური", price: 1.80, desc: "Sweet icing for Sweet Cinnamon Sticks.", desc_ka: "ტკბილი გლეზური ტკბილი დარიჩინის ჯოხებისთვის.", emoji: "🧁", photo: "https://ronnyspizza.com/product_images/icing.jpeg" },
];

export const SEED_DRINKS: Item[] = [
  { id: "cola",         name: "Ronny's Cola", name_ka: "რონის კოლა", price: 3.50, desc: "Classic and refreshing. Our signature craft cola.", desc_ka: "კლასიკური და მაგრილებელი. ჩვენი ფირმოვანი კოლა.", emoji: "🥤", photo: "https://ronnyspizza.ge/product_images/R-Cola.png" },
  { id: "cola-cherry",  name: "Cherry Cola", name_ka: "ალუბლის კოლა", price: 3.50, desc: "Ronny's famous classic. Sweet cherry with craft cola.", desc_ka: "რონის ცნობილი კლასიკა. ტკბილი ალუბალი კოლასთან.", emoji: "🥤", photo: "https://ronnyspizza.ge/product_images/R-Cherry-Cola.png" },
  { id: "cola-vanilla", name: "Vanilla Cola", name_ka: "ვანილის კოლა", price: 3.50, desc: "Soft, creamy, smooth vanilla cola.", desc_ka: "რბილი, ნაღებიანი, გლუვი ვანილის კოლა.", emoji: "🥤", photo: "https://ronnyspizza.ge/product_images/R-Vanilla-Cola.png" },
  { id: "lime",         name: "Lime Soda", name_ka: "ლაიმის სოდა", price: 3.50, desc: "Crisp citrus, clean, and refreshing.", desc_ka: "ხრაშუნა ციტრუსი, სუფთა და მაგრილებელი.", emoji: "🥤", photo: "https://ronnyspizza.ge/product_images/lime-soda.png" },
  { id: "orange",       name: "Orange Soda", name_ka: "ფორთოხლის სოდა", price: 3.50, desc: "Sweet and tangy orange citrus.", desc_ka: "ტკბილი და მკვეთრი ფორთოხლის ციტრუსი.", emoji: "🥤", photo: "https://ronnyspizza.ge/product_images/R-Orange.png" },
  { id: "rootbeer",     name: "Root Beer", name_ka: "რუტ ბირი", price: 3.80, desc: "Sweet, creamy, perfect for a float. A true American classic.", desc_ka: "ტკბილი, ნაღებიანი, ფლოუთებისთვის. ნამდვილი ამერიკული კლასიკა.", emoji: "🫗", photo: "https://ronnyspizza.ge/product_images/R-Rootbeer.png" },
  { id: "beer-ipa",     name: "IPA by Black Lion", name_ka: "IPA Black Lion-ისგან", price: 9.50, desc: "India Pale Ale, locally brewed in Tbilisi by Black Lion.", desc_ka: "ინდური ღია ლუდი, ლოკალურად მოხარშული თბილისში Black Lion-ის მიერ.", emoji: "🍺", photo: "https://ronnyspizza.ge/product_images/IPA.png" },
  { id: "beer-apa",     name: "APA by Black Lion", name_ka: "APA Black Lion-ისგან", price: 9.50, desc: "American Pale Ale, locally brewed in Tbilisi by Black Lion.", desc_ka: "ამერიკული ღია ლუდი, ლოკალურად მოხარშული თბილისში Black Lion-ის მიერ.", emoji: "🍺", photo: "https://ronnyspizza.com/product_images/APA.png" },
  { id: "beer-black",   name: "Black Lion Black", name_ka: "Black Lion შავი", price: 9.50, desc: "Dark craft beer, locally brewed in Tbilisi.", desc_ka: "მუქი კრაფტ ლუდი, ლოკალურად მოხარშული თბილისში.", emoji: "🍺", photo: "https://ronnyspizza.ge/product_images/blackLionBlack.png" },
  { id: "beer-helles",  name: "Black Lion Helles", name_ka: "Black Lion ელესი", price: 6.70, desc: "Light German-style lager, locally brewed by Black Lion.", desc_ka: "მსუბუქი გერმანული სტილის ლაგერი, ლოკალურად მოხარშული Black Lion-ის მიერ.", emoji: "🍺", photo: "https://ronnyspizza.ge/product_images/blacklion.png" },
  { id: "beer-kayaki",  name: "Kayaki", name_ka: "კაიაკი", price: 6.70, desc: "Georgian craft beer. Local flavor, easy drinking.", desc_ka: "ქართული კრაფტ ლუდი. ლოკალური გემო, მსუბუქი დასალევი.", emoji: "🍺", photo: "https://ronnyspizza.ge/product_images/kayaky.png" },
];

export interface Location {
  id: string;
  branch: string;
  branch_ka: string;
  address: string;
  address_ka: string;
  hours: string;
  phone: string;
  mapsUrl: string;
}

export const SEED_LOCATIONS: Location[] = [
  { id:"avlabari",  branch:"Avlabari",  branch_ka:"ავლაბარი",  address:"Ketevan Dedofali Ave 12", address_ka:"ქეთევან დედოფლის გამზ. 12", hours:"11:00–23:00 (Sun 13:00–23:00)", phone:"032 2 472 472", mapsUrl:"https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent("Ronny's Pizza Avlabari, Ketevan Dedofali Ave 12, Tbilisi") },
  { id:"vake",      branch:"Vake",      branch_ka:"ვაკე",      address:"Ilia Chavchavadze Ave 7", address_ka:"ილია ჭავჭავაძის გამზ. 7", hours:"11:00–23:00 (Sun 13:00–23:00)", phone:"032 2 472 472", mapsUrl:"https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent("Ronny's Pizza Vake, Ilia Chavchavadze Ave 7, Tbilisi") },
  { id:"saburtalo", branch:"Saburtalo", branch_ka:"საბურთალო", address:"Vazha-Pshavela Ave 3", address_ka:"ვაჟა-ფშაველას გამზ. 3", hours:"11:00–23:00 (Sun 13:00–23:00)", phone:"032 2 472 472", mapsUrl:"https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent("Ronny's Pizza Saburtalo, Vazha-Pshavela Ave 3, Tbilisi") },
  { id:"dighomi",   branch:"Dighomi",   branch_ka:"დიღომი",    address:"Mirian Mepe St 67", address_ka:"მირიან მეფის ქ. 67", hours:"11:00–23:00 (Sun 13:00–23:00)", phone:"032 2 472 472", mapsUrl:"https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent("Ronny's Pizza Dighomi, Mirian Mepe St 67, Tbilisi") },
  { id:"gldani",    branch:"Gldani",    branch_ka:"გლდანი",    address:"Tsageris 5a, Micro District III", address_ka:"წაგერის ქ. 5ა, III მიკრო-რაიონი", hours:"11:00–23:00 (Sun 13:00–23:00)", phone:"032 2 472 472", mapsUrl:"https://www.google.com/maps/place/Ronny's+Pizza+Gldani/@41.7973731,44.8208584,17z" },
];

export interface HHCombo { id: string; leftId: number; rightId: number; label: string; }
export const HH_COMBOS: HHCombo[] = [
  { id:"hh1", leftId:1,  rightId:3,  label:"Staff favorite" },
  { id:"hh2", leftId:2,  rightId:4,  label:"Most ordered"   },
  { id:"hh3", leftId:8,  rightId:9,  label:"Meat & more meat" },
];

// ── SVG icon (slice) used as the image fallback everywhere ──
export const SLICE_SVG = `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M16 3 L29 27 Q16 31 3 27 Z" fill="#F3DDC4" stroke="#C8692E" stroke-width="1.5" stroke-linejoin="round"/><circle cx="13" cy="14" r="1.6" fill="#B93A1E"/><circle cx="20" cy="16" r="1.6" fill="#B93A1E"/><circle cx="16" cy="21" r="1.6" fill="#6B8E4E"/></svg>`;

// ── localization helpers ──
export function pName(p: Pizza, lang: Lang) { return lang === "ka" ? p.name_ka || p.name : p.name; }
export function pTagline(p: Pizza, lang: Lang) { return lang === "ka" ? p.tagline_ka || p.tagline : p.tagline; }
export function pBadge(p: Pizza, lang: Lang) { return p.badge ? (lang === "ka" ? p.badge_ka || p.badge : p.badge) : null; }
export function tDisp(top: Topping, lang: Lang) { return lang === "ka" ? top.name_ka || top.name : top.name; }
export function itemName(it: Item, lang: Lang) { return lang === "ka" ? it.name_ka || it.name : it.name; }
export function itemDesc(it: Item, lang: Lang) { return lang === "ka" ? it.desc_ka || it.desc : it.desc; }

export function toppingByName(name: string) { return TOPPINGS.find((t) => t.name === name); }
export function ingLabel(name: string, lang: Lang) {
  const top = toppingByName(name);
  return top ? tDisp(top, lang) : name;
}

// ═══════════════════════════════════════════════
// COMBOS (promo bundles) — schema is admin-driven:
// each slot is either a fixed product or a choice list.
// Pricing is a fixed bundle price OR a percent discount off the sum.
// Refs are "pizza:<id>" | "drink:<id>" | "side:<id>".
// ═══════════════════════════════════════════════
export interface ComboSlot {
  label: string;
  label_ka: string;
  mode: "fixed" | "choice";
  options: string[]; // refs; when mode==="fixed" exactly one
}
export interface Combo {
  id: string;
  name: string;
  name_ka: string;
  desc: string;
  desc_ka: string;
  photo?: string;
  pricing: { mode: "fixed" | "discount"; price?: number; percent?: number };
  slots: ComboSlot[];
  badge?: string;
  badge_ka?: string;
  active?: boolean;
}

// SEED_PIZZAS, not PIZZAS: this builds the combo slots for the seed dataset and
// runs at module load, long before any database has answered. Reading the live
// array here would have given an empty list — and the typechecker said so,
// because the live declarations now sit below this line.
const ALL_PIZZA_REFS = SEED_PIZZAS.filter((p) => !p.isBYO).map((p) => `pizza:${p.id}`);

export const SEED_COMBOS: Combo[] = [
  {
    id: "combo-family",
    name: "Family Feast",
    name_ka: "საოჯახო ნადიმი",
    desc: "Two pizzas of your choice + a drink.",
    desc_ka: "ორი პიცა შენი არჩევანით + სასმელი.",
    photo: SEED_PIZZA_PHOTOS[1],
    pricing: { mode: "fixed", price: 42.9 },
    badge: "Best value",
    badge_ka: "საუკეთესო ფასი",
    active: true,
    slots: [
      { label: "Pizza 1", label_ka: "პიცა 1", mode: "choice", options: ALL_PIZZA_REFS },
      { label: "Pizza 2", label_ka: "პიცა 2", mode: "choice", options: ALL_PIZZA_REFS },
      { label: "Drink", label_ka: "სასმელი", mode: "choice", options: ["drink:cola", "drink:cola-cherry", "drink:lime", "drink:orange"] },
    ],
  },
  {
    id: "combo-duo",
    name: "Movie Night Duo",
    name_ka: "კინოს საღამო",
    desc: "Papa Ronny + your side + a drink — 15% off.",
    desc_ka: "პაპა რონი + გვერდითი კერძი + სასმელი — 15% ფასდაკლება.",
    photo: SEED_PIZZA_PHOTOS[4],
    pricing: { mode: "discount", percent: 15 },
    badge: "-15%",
    badge_ka: "-15%",
    active: true,
    slots: [
      { label: "Pizza", label_ka: "პიცა", mode: "fixed", options: ["pizza:4"] },
      { label: "Side", label_ka: "გვერდითი", mode: "choice", options: ["side:sticks", "side:cinsticks", "side:cookies"] },
      { label: "Drink", label_ka: "სასმელი", mode: "choice", options: ["drink:cola", "drink:rootbeer", "drink:orange"] },
    ],
  },
];

// Resolve a combo ref to a display name, base price and photo.
export function resolveRef(ref: string, lang: Lang): { name: string; price: number; photo?: string } | null {
  const [type, id] = ref.split(":");
  if (type === "pizza") {
    const p = PIZZAS.find((x) => x.id === Number(id));
    if (!p) return null;
    return { name: pName(p, lang), price: p.sizes[1], photo: PIZZA_PHOTOS[p.id] };
  }
  const pools = type === "drink" ? [DRINKS] : [EXTRAS, SAUCES];
  for (const arr of pools) {
    const it = arr.find((x) => x.id === id);
    if (it) return { name: itemName(it, lang), price: it.price, photo: it.photo };
  }
  return null;
}

export function comboName(c: Combo, lang: Lang) {
  return lang === "ka" ? c.name_ka : c.name;
}
export function comboDesc(c: Combo, lang: Lang) {
  return lang === "ka" ? c.desc_ka : c.desc;
}
export function comboBadge(c: Combo, lang: Lang) {
  return lang === "ka" ? c.badge_ka : c.badge;
}


// ── DB HYDRATION ──
// ბაზიდან წამოღებული მენიუ ავსებს ზემოთა ცვლადებს.
// ES module live bindings-ის წყალობით ყველა კომპონენტი მაშინვე ხედავს ახალ მნიშვნელობებს —
// ამიტომ არცერთი კომპონენტის შეცვლა არ დაგვჭირდა.

export interface MenuPayload {
  PIZZAS: Pizza[];
  PIZZA_PHOTOS: Record<number, string>;
  TOPPINGS: Topping[];
  TOPPING_PHOTOS: Record<string, string>;
  POPULAR: string[];
  EXTRAS: Item[];
  SAUCES: Item[];
  DRINKS: Item[];
  LOCATIONS: Location[];
  COMBOS: Combo[];
  MAX_TOPPINGS: number;
  MIN_ORDER: number;
  FREE_DELIVERY: number;
  DELIVERY_FEE: number;
}

/* ------------------------------------------------------------------ */
/* The live menu                                                       */
/* ------------------------------------------------------------------ */

/**
 * ⚠️ Empty until the database fills them, and empty is a real answer.
 *
 * These used to be declared as the Ronny's data above — the SEED_ constants —
 * and `applyMenu` ignored empty lists on the reasoning that an old menu beats a
 * blank page. That reasoning is wrong, and on a second tenant it is seriously
 * wrong: a brand-new restaurant's public site served thirteen Ronny's pizzas,
 * with photos hotlinked from ronnyspizza.com, priced in lari, and a Find Us
 * page listing five real Tbilisi addresses under one real phone number.
 *
 * Nothing broke. The site simply answered a question about somebody else.
 *
 * A blank menu is not a failure state to be papered over — it is the correct
 * description of a restaurant whose menu has not been entered yet, and the page
 * that renders it should say so. The SEED_ data above is now exactly what its
 * name says: the dataset `prisma/seed.ts` loads into Ronny's database, and
 * nothing that ships to a browser by default.
 */
export let PIZZAS: Pizza[] = [];
export let TOPPINGS: Topping[] = [];
export let PIZZA_PHOTOS: Record<number, string> = {};
export let TOPPING_PHOTOS: Record<string, string> = {};
export let POPULAR: string[] = [];
export let EXTRAS: Item[] = [];
export let SAUCES: Item[] = [];
export let DRINKS: Item[] = [];
export let LOCATIONS: Location[] = [];
export let COMBOS: Combo[] = [];

/** True when the database has given us nothing to show. */
export function menuIsEmpty(): boolean {
  return PIZZAS.length === 0 && EXTRAS.length === 0 && DRINKS.length === 0 && COMBOS.length === 0;
}

/**
 * Whatever the database said, including nothing.
 *
 * ⚠️ The four numbers below are still conditional, and that is deliberate
 * rather than forgotten. `MIN_ORDER`, `DELIVERY_FEE`, `FREE_DELIVERY` and
 * `MAX_TOPPINGS` decide what a live restaurant charges for delivery. Defaulting
 * them to zero because a settings row was missing would quietly give every
 * customer free delivery, and unlike a wrong menu that failure moves money.
 *
 * They belong in Settings with an explicit "not configured" state, and that is
 * a separate change to make with a test in front of it.
 */
export function applyMenu(m?: Partial<MenuPayload> | null) {
  if (!m) return;

  if (m.PIZZAS) PIZZAS = m.PIZZAS;
  if (m.TOPPINGS) TOPPINGS = m.TOPPINGS;
  if (m.PIZZA_PHOTOS) PIZZA_PHOTOS = m.PIZZA_PHOTOS;
  if (m.TOPPING_PHOTOS) TOPPING_PHOTOS = m.TOPPING_PHOTOS;
  if (m.POPULAR) POPULAR = m.POPULAR;
  if (m.EXTRAS) EXTRAS = m.EXTRAS;
  if (m.SAUCES) SAUCES = m.SAUCES;
  if (m.DRINKS) DRINKS = m.DRINKS;
  if (m.LOCATIONS) LOCATIONS = m.LOCATIONS;
  if (m.COMBOS) COMBOS = m.COMBOS;

  if (typeof m.MAX_TOPPINGS === "number") MAX_TOPPINGS = m.MAX_TOPPINGS;
  if (typeof m.MIN_ORDER === "number") MIN_ORDER = m.MIN_ORDER;
  if (typeof m.FREE_DELIVERY === "number") FREE_DELIVERY = m.FREE_DELIVERY;
  if (typeof m.DELIVERY_FEE === "number") DELIVERY_FEE = m.DELIVERY_FEE;
}
